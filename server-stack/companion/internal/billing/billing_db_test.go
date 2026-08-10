package billing

// These are the tests that cost real money when they are missing: double
// delivery, two callbacks racing, a forged one, and a payment that arrives after
// the order died. All four are statements about Postgres semantics — row locks,
// partial unique indexes, an atomic status transition — so none of them can be
// made with a mock driver. They run against a real database and SKIP when there
// is none, rather than silently passing on a fake:
//
//	COMPANION_TEST_DSN (or COMPANION_DB_DSN) must point at an anoon database.
//	The compose db is not published to the host, so from a dev box run them
//	inside the compose network, e.g.:
//
//	  docker run --rm --network anoon-tinode_default \
//	    -v "$PWD":/src -v "$(go env GOMODCACHE)":/go/pkg/mod -w /src \
//	    -e COMPANION_TEST_DSN="postgres://postgres:PASS@db:5432/anoon?sslmode=disable" \
//	    golang:1.23 go test ./internal/billing/... -v

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"anoon/companion/internal/db"
)

const (
	testCoinPack   = "coins_50" // 50 coins for 490 AMD (products seed, 0016)
	testPackCoins  = 50
	testPackAmount = 490
)

// newTestService opens the test database, applies migrations, and returns a
// Service on the sandbox provider.
func newTestService(t *testing.T, orderTTL time.Duration) *Service {
	t.Helper()
	dsn := os.Getenv("COMPANION_TEST_DSN")
	if dsn == "" {
		dsn = os.Getenv("COMPANION_DB_DSN")
	}
	if dsn == "" {
		t.Skip("no COMPANION_TEST_DSN / COMPANION_DB_DSN — skipping the database-backed billing tests")
	}
	ctx := context.Background()
	database, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := database.Migrate(ctx); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	return New(database, testFake(), orderTTL, nil)
}

// newTestUser inserts a throwaway account and removes it (with everything that
// hangs off it) when the test ends.
func newTestUser(t *testing.T, s *Service) int64 {
	t.Helper()
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatalf("rand: %v", err)
	}
	uid := "usrTest" + hex.EncodeToString(b[:])

	var id int64
	err := s.db.QueryRowContext(context.Background(), `
		INSERT INTO users (tinode_uid, hash_id, gender, real_gender)
		VALUES ($1, nextval('hash_id_seq'), 'male', 'male') RETURNING id`, uid).Scan(&id)
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		// payment_events survive their order (ON DELETE SET NULL) by design, so
		// they are cleared first or the test would litter the audit table.
		_, _ = s.db.ExecContext(ctx,
			`DELETE FROM payment_events WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)`, id)
		_, _ = s.db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// deliver posts a correctly signed callback for order, exactly as the provider
// would. Returns whether this delivery granted anything.
func deliver(t *testing.T, s *Service, orderID string, amount int64, status string) (bool, error) {
	t.Helper()
	body := []byte(`{"orderId":"` + orderID + `","ref":"pay-` + orderID + `","amountAmd":` +
		itoa(amount) + `,"status":"` + status + `"}`)
	h := http.Header{}
	h.Set(fakeSignatureHeader, s.provider.(*fakeProvider).sign(body))
	return s.ingest(context.Background(), h, body)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

func coinsOf(t *testing.T, s *Service, userID int64) int64 {
	t.Helper()
	var coins int64
	err := s.db.QueryRowContext(context.Background(),
		`SELECT COALESCE(SUM(coins),0) FROM subscriptions WHERE user_id = $1`, userID).Scan(&coins)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	return coins
}

func countRows(t *testing.T, s *Service, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.db.QueryRowContext(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func statusOf(t *testing.T, s *Service, orderID string) string {
	t.Helper()
	var st string
	if err := s.db.QueryRowContext(context.Background(),
		`SELECT status FROM orders WHERE id = $1`, orderID).Scan(&st); err != nil {
		t.Fatalf("read order status: %v", err)
	}
	return st
}

// THE test. Providers retry callbacks, networks duplicate them, and Idram's
// protocol delivers two phases for one payment. If the second delivery credits
// the coins again, every retry is free money — this is the single failure this
// module exists to prevent.
func TestWebhookDoubleDeliveryGrantsOnce(t *testing.T) {
	s := newTestService(t, time.Hour)
	userID := newTestUser(t, s)
	ctx := context.Background()

	order, err := s.CreateOrder(ctx, userID, testCoinPack)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	if order.AmountAMD != testPackAmount {
		t.Fatalf("order amount = %d, want %d (price must come from products, not the client)", order.AmountAMD, testPackAmount)
	}

	granted, err := deliver(t, s, order.ID, testPackAmount, "paid")
	if err != nil || !granted {
		t.Fatalf("first delivery = (%v, %v), want (true, nil)", granted, err)
	}
	if got := coinsOf(t, s, userID); got != testPackCoins {
		t.Fatalf("balance after the first delivery = %d, want %d", got, testPackCoins)
	}

	// The same event again — and a third time for good measure.
	for i := 2; i <= 3; i++ {
		granted, err := deliver(t, s, order.ID, testPackAmount, "paid")
		if err != nil {
			t.Fatalf("delivery %d returned an error: %v — a duplicate must be acknowledged, not failed", i, err)
		}
		if granted {
			t.Fatalf("delivery %d granted again: the idempotency guard did not hold", i)
		}
	}

	if got := coinsOf(t, s, userID); got != testPackCoins {
		t.Fatalf("balance after three deliveries = %d, want %d — coins were credited more than once", got, testPackCoins)
	}
	if n := countRows(t, s, `SELECT count(*) FROM coin_ledger WHERE order_id = $1`, order.ID); n != 1 {
		t.Fatalf("ledger rows for the order = %d, want exactly 1", n)
	}
	// Every delivery is on record even though only one moved money (§4.2 rule 1).
	if n := countRows(t, s, `SELECT count(*) FROM payment_events WHERE order_id = $1`, order.ID); n != 3 {
		t.Fatalf("payment_events for the order = %d, want 3 — every callback must be recorded", n)
	}
	if st := statusOf(t, s, order.ID); st != "paid" {
		t.Fatalf("order status = %q, want paid", st)
	}
}

// Two callbacks arriving at the same instant is the case a SELECT-then-UPDATE
// would get wrong, and the case a provider's retry storm produces in practice.
func TestConcurrentWebhooksGrantOnce(t *testing.T) {
	s := newTestService(t, time.Hour)
	userID := newTestUser(t, s)

	order, err := s.CreateOrder(context.Background(), userID, testCoinPack)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}

	const racers = 8
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		grants  int
		errored []error
		start   = make(chan struct{})
	)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release them all together
			granted, err := deliver(t, s, order.ID, testPackAmount, "paid")
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errored = append(errored, err)
			}
			if granted {
				grants++
			}
		}()
	}
	close(start)
	wg.Wait()

	if len(errored) > 0 {
		t.Fatalf("%d of %d concurrent deliveries errored: %v", len(errored), racers, errored[0])
	}
	if grants != 1 {
		t.Fatalf("%d of %d concurrent deliveries granted, want exactly 1", grants, racers)
	}
	if got := coinsOf(t, s, userID); got != testPackCoins {
		t.Fatalf("balance after %d concurrent deliveries = %d, want %d", racers, got, testPackCoins)
	}
	if n := countRows(t, s, `SELECT count(*) FROM coin_ledger WHERE order_id = $1`, order.ID); n != 1 {
		t.Fatalf("ledger rows = %d, want exactly 1", n)
	}
}

// A callback nobody could have signed must move nothing — and must still be
// stored, flagged, because a forged callback is evidence.
func TestForgedWebhookGrantsNothing(t *testing.T) {
	s := newTestService(t, time.Hour)
	userID := newTestUser(t, s)
	ctx := context.Background()

	order, err := s.CreateOrder(ctx, userID, testCoinPack)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}

	body := []byte(`{"orderId":"` + order.ID + `","ref":"forged","amountAmd":490,"status":"paid"}`)
	h := http.Header{}
	h.Set(fakeSignatureHeader, "deadbeef")

	granted, err := s.ingest(ctx, h, body)
	if granted {
		t.Fatal("a forged callback granted coins")
	}
	if err == nil {
		t.Fatal("a forged callback was accepted without error")
	}
	if got := coinsOf(t, s, userID); got != 0 {
		t.Fatalf("balance after a forged callback = %d, want 0", got)
	}
	if st := statusOf(t, s, order.ID); st != "new" {
		t.Fatalf("order status after a forged callback = %q, want new", st)
	}
	// Recorded, and recorded as bad — but NOT attributed to the order: the only
	// thing naming that order was the forged body, and an audit trail that links
	// a forgery to a real order on the forger's say-so is worse than one that
	// does not. The body itself is kept verbatim, which is what a dispute needs.
	var sigOK bool
	var note string
	if err := s.db.QueryRowContext(ctx, `
		SELECT signature_ok, note FROM payment_events
		 WHERE raw->>'body' LIKE '%' || $1 || '%' ORDER BY id DESC LIMIT 1`, order.ID).Scan(&sigOK, &note); err != nil {
		t.Fatalf("the forged callback was not recorded at all: %v", err)
	}
	if sigOK {
		t.Fatal("the forged callback was recorded as signature_ok")
	}
	if note == "" {
		t.Fatal("the forged callback was recorded without a reason")
	}
	if n := countRows(t, s, `SELECT count(*) FROM payment_events WHERE order_id = $1`, order.ID); n != 0 {
		t.Fatalf("%d forged events were attributed to the order, want 0", n)
	}
	// Clean up: the row has no order_id, so the per-user cleanup cannot find it.
	_, _ = s.db.ExecContext(ctx, `DELETE FROM payment_events WHERE raw->>'body' LIKE '%' || $1 || '%'`, order.ID)
}

// An authentic callback that names the right order but the wrong amount is not
// a payment. It is a misconfiguration or a probe, and it must not grant.
func TestAmountMismatchGrantsNothing(t *testing.T) {
	s := newTestService(t, time.Hour)
	userID := newTestUser(t, s)

	order, err := s.CreateOrder(context.Background(), userID, testCoinPack)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}

	granted, err := deliver(t, s, order.ID, 1, "paid") // one dram for a 490 dram pack
	if err != nil {
		t.Fatalf("delivery errored: %v", err)
	}
	if granted {
		t.Fatal("a callback claiming the wrong amount granted the product")
	}
	if got := coinsOf(t, s, userID); got != 0 {
		t.Fatalf("balance = %d, want 0", got)
	}
	if st := statusOf(t, s, order.ID); st != "new" {
		t.Fatalf("order status = %q, want new (it was never paid)", st)
	}
}

// An order has a lifetime. A payment that lands after it must not be honoured
// at a price we no longer offer — it becomes a refund case, and the order goes
// to a terminal state instead of sitting open forever.
func TestExpiredOrderIsNotGranted(t *testing.T) {
	s := newTestService(t, time.Hour)
	userID := newTestUser(t, s)
	ctx := context.Background()

	order, err := s.CreateOrder(ctx, userID, testCoinPack)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	// Age the order past its deadline: the row a payer who opened the bank page
	// and walked away leaves behind. (Configuring a negative TTL would not do
	// it — New clamps a non-positive TTL to the default, on purpose.)
	if _, err := s.db.ExecContext(ctx,
		`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = $1`, order.ID); err != nil {
		t.Fatalf("age the order: %v", err)
	}

	granted, err := deliver(t, s, order.ID, testPackAmount, "paid")
	if err != nil {
		t.Fatalf("delivery errored: %v", err)
	}
	if granted {
		t.Fatal("an expired order was granted")
	}
	if got := coinsOf(t, s, userID); got != 0 {
		t.Fatalf("balance = %d, want 0", got)
	}
	if st := statusOf(t, s, order.ID); st != "expired" {
		t.Fatalf("order status = %q, want expired", st)
	}
	// And the status endpoint agrees, for a caller who never sends a callback.
	got, err := s.OrderOf(context.Background(), userID, order.ID)
	if err != nil {
		t.Fatalf("OrderOf: %v", err)
	}
	if got.Status != "expired" {
		t.Fatalf("OrderOf status = %q, want expired", got.Status)
	}
}

// A subscription purchase must move the tier and set an end date the rest of the
// service already reads (store.WalletOf / Store.Priority), and renewing early
// must add to the remaining time rather than replace it.
func TestSubscriptionGrantSetsTierAndExtends(t *testing.T) {
	s := newTestService(t, time.Hour)
	userID := newTestUser(t, s)
	ctx := context.Background()

	pay := func() {
		t.Helper()
		order, err := s.CreateOrder(ctx, userID, "premium_1m")
		if err != nil {
			t.Fatalf("CreateOrder: %v", err)
		}
		if order.AmountAMD != 1990 {
			t.Fatalf("premium price = %d, want 1990", order.AmountAMD)
		}
		granted, err := deliver(t, s, order.ID, 1990, "paid")
		if err != nil || !granted {
			t.Fatalf("subscription delivery = (%v, %v), want (true, nil)", granted, err)
		}
	}

	pay()
	var tier string
	var expires time.Time
	if err := s.db.QueryRowContext(ctx,
		`SELECT tier, expires_at FROM subscriptions WHERE user_id = $1`, userID).Scan(&tier, &expires); err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	if tier != "premium" {
		t.Fatalf("tier = %q, want premium", tier)
	}
	if d := time.Until(expires); d < 29*24*time.Hour || d > 31*24*time.Hour {
		t.Fatalf("expires_at is %v away, want ~30 days", d)
	}

	pay() // renew while still active
	var extended time.Time
	if err := s.db.QueryRowContext(ctx,
		`SELECT expires_at FROM subscriptions WHERE user_id = $1`, userID).Scan(&extended); err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	if d := time.Until(extended); d < 59*24*time.Hour {
		t.Fatalf("after renewing early expires_at is %v away, want ~60 days — the paid-for days were thrown away", d)
	}
}

// The client picks a product code, never a price. An unknown code is a bad
// request, not an order for zero drams.
func TestCreateOrderRejectsUnknownProduct(t *testing.T) {
	s := newTestService(t, time.Hour)
	userID := newTestUser(t, s)

	if _, err := s.CreateOrder(context.Background(), userID, "coins_1000000"); err == nil {
		t.Fatal("CreateOrder accepted an unknown product code")
	}
}

// One user must not be able to read another's order, and the "not yours" answer
// must be indistinguishable from "does not exist" — otherwise the endpoint
// enumerates other people's purchases.
func TestOrderOfIsScopedToItsOwner(t *testing.T) {
	s := newTestService(t, time.Hour)
	owner := newTestUser(t, s)
	stranger := newTestUser(t, s)

	order, err := s.CreateOrder(context.Background(), owner, testCoinPack)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}
	if _, err := s.OrderOf(context.Background(), stranger, order.ID); err != ErrNoOrder {
		t.Fatalf("OrderOf for a stranger = %v, want ErrNoOrder", err)
	}
	// A malformed id is the same answer, not a 500.
	if _, err := s.OrderOf(context.Background(), owner, "not-a-uuid"); err != ErrNoOrder {
		t.Fatalf("OrderOf with a malformed id = %v, want ErrNoOrder", err)
	}
}
