// Package billing implements the money half of anoon (#14): a product
// catalogue, orders, provider callbacks, and the grant that turns a confirmed
// payment into coins or a paid tier.
//
// The provider is NOT chosen yet (docs/PAYMENTS-PLAN.md §5-6). Everything that
// would differ between Ameriabank vPOS, Idram, Telcell or a high-risk MoR sits
// behind the Provider interface in provider.go; this file knows only that
// *something* confirmed a payment.
//
// Two rules the rest of the package exists to enforce:
//
//  1. Money is granted only on a provider-confirmed callback. Nothing a client
//     sends — not the return-URL redirect, not a request body — can add a coin.
//  2. A grant happens at most once per order, whatever the provider retries or
//     however many callbacks race. That is the failure that costs real money in
//     production, so it is guarded twice: an atomic status transition on
//     `orders`, and a unique index on the ledger row it writes.
package billing

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"anoon/companion/internal/db"
)

// defaultOrderTTL is how long an unpaid order stays payable. Long enough for a
// slow bank page and a 3-D Secure SMS, short enough that a price change is not
// honoured a day later. Override with BILLING_ORDER_TTL.
const defaultOrderTTL = 30 * time.Minute

// maxWebhookBody caps a callback body. Providers post a few hundred bytes; the
// cap is what stops an unauthenticated endpoint from being a memory sink.
const maxWebhookBody = 64 << 10

// Product is one purchasable thing from the `products` table.
type Product struct {
	Code       string `json:"code"`
	Kind       string `json:"kind"`                 // "coins" | "sub"
	Tier       string `json:"tier,omitempty"`       // paid tier, for kind=="sub"
	PeriodDays int    `json:"periodDays,omitempty"` // subscription length, for kind=="sub"
	Coins      int64  `json:"coins,omitempty"`      // coins granted, for kind=="coins"
	PriceAMD   int64  `json:"priceAmd"`
}

// Order is one purchase attempt.
type Order struct {
	ID          string    `json:"id"`
	ProductCode string    `json:"productCode"`
	Provider    string    `json:"provider"`
	AmountAMD   int64     `json:"amountAmd"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
	// PayURL is only set on the response to creation — it is the provider's
	// hosted page, not something we store.
	PayURL string `json:"payUrl,omitempty"`
}

// Service is the billing module. Construct with New (or FromEnv for the wiring
// the server actually uses).
type Service struct {
	db       *db.DB
	provider Provider
	orderTTL time.Duration

	// authUser resolves the caller of an authenticated billing route to a
	// companion user id. Supplied by the api package, which owns auth; billing
	// stays out of the token business entirely.
	authUser func(*http.Request) (int64, bool)
}

// New builds a Service over the given database and provider.
func New(database *db.DB, p Provider, orderTTL time.Duration, authUser func(*http.Request) (int64, bool)) *Service {
	if orderTTL <= 0 {
		orderTTL = defaultOrderTTL
	}
	return &Service{db: database, provider: p, orderTTL: orderTTL, authUser: authUser}
}

// FromEnv builds the Service from the environment, or returns nil when billing
// is not configured (BILLING_PROVIDER unset) — the shipped default, since no
// provider exists yet. A nil *Service registers no routes at all.
//
//	BILLING_PROVIDER     "fake" — the sandbox. Real codes land here as they are
//	                     implemented; an unknown value is refused at startup.
//	BILLING_FAKE_SECRET  HMAC key the sandbox callback is signed with. Required
//	                     when the provider is "fake".
//	BILLING_BASE_URL     public origin of this service, used to build the
//	                     sandbox checkout URL (default "http://127.0.0.1:6062").
//	BILLING_ORDER_TTL    Go duration; how long an order stays payable (30m).
//
// ENV is read here too (the same key config.Load uses, same "prod" default):
// the sandbox provider is refused in production, where its signing key would be
// a licence to print coins.
func FromEnv(database *db.DB, authUser func(*http.Request) (int64, bool)) (*Service, error) {
	name := strings.TrimSpace(os.Getenv("BILLING_PROVIDER"))
	if name == "" {
		return nil, nil
	}
	ttl := defaultOrderTTL
	if raw := os.Getenv("BILLING_ORDER_TTL"); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return nil, fmt.Errorf("billing: BILLING_ORDER_TTL: %w", err)
		}
		ttl = d
	}

	// Defaults to "prod" exactly like config.Load, so a process started without
	// ENV cannot reach the sandbox provider by omission.
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENV")))
	if env == "" {
		env = "prod"
	}

	switch name {
	case "fake":
		if env == "prod" {
			return nil, errors.New("billing: BILLING_PROVIDER=fake is a sandbox whose signing key mints payments — refusing to start with ENV=prod")
		}
		secret := os.Getenv("BILLING_FAKE_SECRET")
		if secret == "" {
			return nil, errors.New("billing: BILLING_PROVIDER=fake requires BILLING_FAKE_SECRET")
		}
		base := os.Getenv("BILLING_BASE_URL")
		if base == "" {
			base = "http://127.0.0.1:6062"
		}
		return New(database, &fakeProvider{secret: []byte(secret), baseURL: base}, ttl, authUser), nil
	default:
		return nil, fmt.Errorf("billing: unknown BILLING_PROVIDER %q (no real provider is implemented yet — see docs/PAYMENTS-PLAN.md §6)", name)
	}
}

// ProviderName is the configured provider's code, for logging and route checks.
func (s *Service) ProviderName() string { return s.provider.Name() }

// --- catalogue -------------------------------------------------------------

// Products returns the active catalogue, cheapest first within each kind.
func (s *Service) Products(ctx context.Context) ([]Product, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT code, kind, COALESCE(tier,''), COALESCE(period_days,0), coins, price_amd
		  FROM products WHERE active ORDER BY kind, price_amd`)
	if err != nil {
		return nil, fmt.Errorf("billing: products: %w", err)
	}
	defer rows.Close()
	var out []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.Code, &p.Kind, &p.Tier, &p.PeriodDays, &p.Coins, &p.PriceAMD); err != nil {
			return nil, fmt.Errorf("billing: products: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// --- orders ----------------------------------------------------------------

// ErrNoProduct is returned when the requested product code is unknown or
// inactive. It is a 404/400 to the caller, never a 500.
var ErrNoProduct = errors.New("billing: no such product")

// ErrNoOrder is returned when an order id does not exist, or belongs to
// somebody else — deliberately the same error, so the status endpoint cannot be
// used to enumerate other people's orders.
var ErrNoOrder = errors.New("billing: no such order")

// CreateOrder opens an order for userID against productCode and asks the
// provider for a payment URL.
//
// The price is read from `products` inside the same statement that inserts the
// order: the client names a product, never an amount. That is the whole reason
// the catalogue moved server-side.
func (s *Service) CreateOrder(ctx context.Context, userID int64, productCode string) (Order, error) {
	var o Order
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO orders (user_id, product_code, provider, amount_amd, expires_at)
		SELECT $1, code, $2, price_amd, now() + $3::interval
		  FROM products WHERE code = $4 AND active
		RETURNING id, product_code, provider, amount_amd, status, created_at, expires_at`,
		userID, s.provider.Name(), intervalArg(s.orderTTL), productCode,
	).Scan(&o.ID, &o.ProductCode, &o.Provider, &o.AmountAMD, &o.Status, &o.CreatedAt, &o.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Order{}, ErrNoProduct
	}
	if err != nil {
		return Order{}, fmt.Errorf("billing: create order: %w", err)
	}

	payURL, err := s.provider.Checkout(o)
	if err != nil {
		// The order row stays behind on purpose: it expires on its own, and an
		// order with no checkout is exactly the evidence needed to tell "the
		// provider was down" from "the user never paid".
		return Order{}, fmt.Errorf("billing: checkout for order %s: %w", o.ID, err)
	}
	o.PayURL = payURL
	return o, nil
}

// OrderOf returns one order belonging to userID. The status it reports is the
// effective one: an order past its expiry that was never paid reads back as
// "expired" even though no sweeper has touched the row — there is no worker,
// and inventing one to change a value we can derive would be a second source of
// truth about the same fact.
func (s *Service) OrderOf(ctx context.Context, userID int64, orderID string) (Order, error) {
	var o Order
	err := s.db.QueryRowContext(ctx, `
		SELECT id, product_code, provider, amount_amd, status, created_at, expires_at
		  FROM orders WHERE id = $1 AND user_id = $2`, orderID, userID,
	).Scan(&o.ID, &o.ProductCode, &o.Provider, &o.AmountAMD, &o.Status, &o.CreatedAt, &o.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Order{}, ErrNoOrder
	}
	if err != nil {
		// A malformed uuid arrives here as a scan/parse error from the driver,
		// not as ErrNoRows; it is still just "no such order" to the caller.
		if isBadUUID(err) {
			return Order{}, ErrNoOrder
		}
		return Order{}, fmt.Errorf("billing: order %s: %w", orderID, err)
	}
	if isOpen(o.Status) && o.ExpiresAt.Before(time.Now()) {
		o.Status = "expired"
	}
	return o, nil
}

// isOpen reports whether an order is still awaiting payment.
func isOpen(status string) bool { return status == "new" || status == "pending" }

// --- the grant -------------------------------------------------------------

// ingest is the whole callback path: record the raw event, then — only if it
// verifies — apply it. It is called from the webhook route and from the sandbox
// checkout page, which is exactly the point: the sandbox gets no shortcut past
// the signature check or the idempotency guard.
//
// It returns whether this particular delivery granted anything. A repeat
// delivery of an event we have already applied returns false with a nil error:
// that is success, not failure — the provider must be acknowledged, or it
// retries forever.
func (s *Service) ingest(ctx context.Context, h http.Header, body []byte) (granted bool, err error) {
	ev, parseErr := s.provider.ParseWebhook(h, body)

	// Raw first, before anything is trusted (PAYMENTS-PLAN §4.2 rule 1). The
	// note is filled in below; the row is written now so that even a panic in
	// the grant leaves the event on disk.
	sigOK := !errors.Is(parseErr, ErrBadSignature)
	note := "accepted"
	switch {
	case errors.Is(parseErr, ErrBadSignature):
		note = "rejected: signature"
	case parseErr != nil:
		note = "rejected: " + parseErr.Error()
	}

	defer func() {
		// The audit write must not be able to fail the callback: a provider that
		// gets a 500 retries, and retrying is precisely what the idempotency
		// guard is for — but a lost acknowledgement over an event we DID apply is
		// a support ticket, so the grant's outcome wins.
		if recErr := s.recordEvent(ctx, ev.OrderID, body, sigOK, note); recErr != nil {
			log.Printf("billing: could not record payment event (%s): %v", note, recErr)
		}
	}()

	if parseErr != nil {
		if errors.Is(parseErr, ErrBadSignature) {
			return false, parseErr
		}
		return false, fmt.Errorf("%w: %v", ErrBadCallback, parseErr)
	}
	if !ev.Paid {
		note = "provider reported failure"
		s.markFailed(ctx, ev)
		return false, nil
	}

	granted, note, err = s.applyPaid(ctx, ev)
	if err != nil {
		note = "grant failed: " + err.Error()
	}
	return granted, err
}

// applyPaid is the money transaction. Everything it does happens in one commit:
// the order flips to paid, the ledger row is written, the balance/tier moves.
// Either all of it or none of it (PAYMENTS-PLAN §4.2 rule 6).
func (s *Service) applyPaid(ctx context.Context, ev Event) (granted bool, note string, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, "", fmt.Errorf("billing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// The single atomic transition, and the entire race defence: whichever of
	// two concurrent callbacks reaches this UPDATE first takes the row lock and
	// leaves status='paid' behind; the second blocks on the lock, then matches
	// zero rows and grants nothing. There is deliberately no SELECT-then-UPDATE
	// anywhere on this path (§4.2 rule 3).
	//
	// The amount comes from our own row (amount_amd = $3 is a guard, not a
	// price): a callback claiming a different sum matches nothing and is
	// reported as an incident below (§4.2 rule 4).
	var userID int64
	var productCode string
	err = tx.QueryRowContext(ctx, `
		UPDATE orders
		   SET status = 'paid', paid_at = now(), provider_ref = COALESCE(provider_ref, NULLIF($2,''))
		 WHERE id = $1
		   AND status IN ('new','pending')
		   AND expires_at > now()
		   AND amount_amd = $3
		RETURNING user_id, product_code`,
		ev.OrderID, ev.Ref, ev.AmountAMD,
	).Scan(&userID, &productCode)
	if errors.Is(err, sql.ErrNoRows) {
		// Nothing was granted. Why not is worth knowing precisely: a repeat
		// delivery is routine, an amount mismatch is an incident. Close the
		// transaction before diagnosing — explainNoMatch may write (expiring the
		// order), and it must never do that from behind a lock this tx holds.
		_ = tx.Rollback()
		return false, s.explainNoMatch(ctx, ev), nil
	}
	if err != nil {
		if isBadUUID(err) {
			return false, "unknown order id", nil
		}
		return false, "", fmt.Errorf("billing: claim order %s: %w", ev.OrderID, err)
	}

	var kind, tier string
	var periodDays int
	var coins int64
	if err := tx.QueryRowContext(ctx, `
		SELECT kind, COALESCE(tier,''), COALESCE(period_days,0), coins
		  FROM products WHERE code = $1`, productCode).Scan(&kind, &tier, &periodDays, &coins); err != nil {
		return false, "", fmt.Errorf("billing: product %s: %w", productCode, err)
	}

	if coins > 0 {
		// ON CONFLICT DO NOTHING is the belt to the UPDATE's braces: one order
		// can write one purchase row, even if the guard above were ever loosened.
		res, err := tx.ExecContext(ctx, `
			INSERT INTO coin_ledger (user_id, delta, reason, order_id, ref)
			VALUES ($1, $2, 'purchase', $3, jsonb_build_object('productCode', $4::text))
			ON CONFLICT DO NOTHING`, userID, coins, ev.OrderID, productCode)
		if err != nil {
			return false, "", fmt.Errorf("billing: ledger: %w", err)
		}
		if n, _ := res.RowsAffected(); n == 0 {
			// The ledger already holds this grant. Do not touch the balance.
			return false, "already granted (ledger)", tx.Commit()
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO subscriptions (user_id, coins) VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE
			   SET coins = subscriptions.coins + EXCLUDED.coins, updated_at = now()`,
			userID, coins); err != nil {
			return false, "", fmt.Errorf("billing: credit coins: %w", err)
		}
	}

	if kind == "sub" {
		// Extend from whichever is later, the current expiry or now: renewing
		// early must not throw away the days already paid for, and a lapsed
		// subscription must not be back-dated into an instantly-expired one.
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO subscriptions (user_id, tier, expires_at)
			VALUES ($1, $2, now() + make_interval(days => $3))
			ON CONFLICT (user_id) DO UPDATE
			   SET tier = EXCLUDED.tier,
			       expires_at = GREATEST(COALESCE(subscriptions.expires_at, now()), now())
			                    + make_interval(days => $3),
			       updated_at = now()`,
			userID, tier, periodDays); err != nil {
			return false, "", fmt.Errorf("billing: grant tier: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return false, "", fmt.Errorf("billing: commit: %w", err)
	}
	return true, "granted", nil
}

// explainNoMatch works out why the claiming UPDATE matched nothing, so the
// audit row says something useful. It runs outside the failed claim on purpose:
// it is diagnostics, and must never be able to hold a lock or fail the callback.
func (s *Service) explainNoMatch(ctx context.Context, ev Event) string {
	var status string
	var amount int64
	var expired bool
	err := s.db.QueryRowContext(ctx, `
		SELECT status, amount_amd, expires_at <= now() FROM orders WHERE id = $1`,
		ev.OrderID).Scan(&status, &amount, &expired)
	if errors.Is(err, sql.ErrNoRows) || (err != nil && isBadUUID(err)) {
		return "unknown order id"
	}
	if err != nil {
		return "already applied or unknown (lookup failed: " + err.Error() + ")"
	}
	switch {
	case status == "paid":
		return "duplicate delivery: order already paid"
	case amount != ev.AmountAMD:
		// Never a payment. Somebody is either misconfigured or probing.
		log.Printf("billing: INCIDENT order %s: callback claims %d AMD, order is %d AMD", ev.OrderID, ev.AmountAMD, amount)
		return fmt.Sprintf("amount mismatch: callback %d, order %d", ev.AmountAMD, amount)
	case expired:
		// The payer took too long. Close the order so it stops looking open;
		// the money, if it really moved, is a refund case for support, not
		// something to grant against a price we no longer honour.
		if _, err := s.db.ExecContext(ctx,
			`UPDATE orders SET status='expired' WHERE id=$1 AND status IN ('new','pending')`, ev.OrderID); err != nil {
			log.Printf("billing: could not expire order %s: %v", ev.OrderID, err)
		}
		log.Printf("billing: INCIDENT order %s: paid callback for an EXPIRED order — refund case", ev.OrderID)
		return "order expired before the callback arrived"
	default:
		return "order not claimable (status " + status + ")"
	}
}

// markFailed closes an order the provider says was not paid. Best effort: the
// terminal state that matters is 'paid', and a failed callback that we fail to
// record just leaves the order to expire on its own.
func (s *Service) markFailed(ctx context.Context, ev Event) {
	if _, err := s.db.ExecContext(ctx, `
		UPDATE orders SET status = 'failed'
		 WHERE id = $1 AND status IN ('new','pending')`, ev.OrderID); err != nil && !isBadUUID(err) {
		log.Printf("billing: could not mark order %s failed: %v", ev.OrderID, err)
	}
}

// recordEvent writes the audit row. The body is stored verbatim as a string
// inside a JSON envelope rather than parsed as JSON: the real candidates
// (Idram, Telcell) post urlencoded forms, and an event we could not parse is
// exactly the one worth keeping byte-for-byte.
func (s *Service) recordEvent(ctx context.Context, orderID string, body []byte, sigOK bool, note string) error {
	raw, err := json.Marshal(map[string]string{"body": string(body)})
	if err != nil {
		return err
	}
	var oid any
	if orderID != "" && looksLikeUUID(orderID) {
		oid = orderID
	}
	// The order_id FK may still not resolve (an event naming an order that was
	// deleted with its user); fall back to a NULL rather than lose the event.
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO payment_events (provider, order_id, raw, signature_ok, note)
		VALUES ($1, (SELECT id FROM orders WHERE id = $2::uuid), $3, $4, $5)`,
		s.provider.Name(), oid, raw, sigOK, note)
	return err
}

// --- small helpers ---------------------------------------------------------

// intervalArg renders a Go duration as a Postgres interval literal.
func intervalArg(d time.Duration) string {
	return strconv.FormatInt(int64(d/time.Second), 10) + " seconds"
}

// looksLikeUUID is a shape check, not a validation: it keeps a junk order id
// out of a uuid parameter, where the driver would turn it into an error the
// caller cannot tell from a real database failure.
func looksLikeUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// isBadUUID reports whether err is Postgres refusing a malformed uuid literal
// (SQLSTATE 22P02, invalid_text_representation). That is a bad request, not a
// database failure, and callers turn it into "no such order".
func isBadUUID(err error) bool {
	return err != nil && strings.Contains(err.Error(), "22P02")
}
