//go:build integration

// Package integration holds live end-to-end tests that require a running anoon
// stack (Tinode gRPC + Postgres). They are excluded from the normal `go test`
// run by the `integration` build tag; run explicitly with:
//
//	go test -tags integration ./internal/integration/... -v
//
// Config via env (with host-friendly defaults):
//
//	TINODE_GRPC_ADDR   Tinode Node gRPC (default "localhost:16061")
//	COMPANION_DB_DSN   Postgres DSN for the anoon DB. When unreachable from the
//	                   host (the compose `db` service is not published), run this
//	                   test from inside the compose network with
//	                   COMPANION_DB_DSN="postgres://postgres:PASS@db:5432/anoon?sslmode=disable".
//	                   TestRegisterEndToEnd skips when the DSN is unset.
package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"anoon/companion/internal/api"
	"anoon/companion/internal/db"
	"anoon/companion/internal/store"
	"anoon/companion/internal/tinode"
)

func grpcAddr() string {
	if v := os.Getenv("TINODE_GRPC_ADDR"); v != "" {
		return v
	}
	return "localhost:16061"
}

var hashIDRe = regexp.MustCompile(`^#\d{5,}$`)

// uniqueLogin builds a short, unique, lowercase basic login. Tinode's basic
// scheme caps logins at 32 chars, so we use a compact base-36 nanosecond suffix.
func uniqueLogin(prefix string) string {
	return fmt.Sprintf("%s%s", prefix, strconv.FormatInt(time.Now().UnixNano(), 36))
}

// TestTinodeCreateAccountLive verifies the companion can create a Tinode account
// over live gRPC (the #ID-registration path). Account creation is anonymous, so
// no ROOT bot is needed. Requires only Tinode (host-reachable on :16061).
func TestTinodeCreateAccountLive(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client := tinode.New(grpcAddr(), "", "") // creds unused: CreateAccount self-dials anonymously
	login := uniqueLogin("ituser")
	uid, err := client.CreateAccount(ctx, "basic", []byte(login+":userPass123"), nil)
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	if !strings.HasPrefix(uid, "usr") {
		t.Fatalf("expected usr-prefixed uid, got %q", uid)
	}
	t.Logf("created account %s -> %s", login, uid)
}

// TestRegisterEndToEnd drives the real HTTP handler against live Tinode + the
// anoon Postgres DB: POST /auth/register must create a Tinode account and return
// a usr-prefixed UID plus a formatted #ID. Skips when COMPANION_DB_DSN is unset.
func TestRegisterEndToEnd(t *testing.T) {
	dsn := os.Getenv("COMPANION_DB_DSN")
	if dsn == "" {
		t.Skip("COMPANION_DB_DSN not set; run inside the compose network to reach the db service")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	database, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// Registration does not require the ROOT bot; the client self-dials for {acc}.
	client := tinode.New(grpcAddr(), "", "")
	ts := httptest.NewServer(api.NewServer(database, client, nil, false, "", "", "", 2*time.Hour, "", "", "", nil, 0, 0, nil).Handler())
	defer ts.Close()

	body := fmt.Sprintf(`{"login":%q,"password":"userPass123","gender":"male","age":27}`, uniqueLogin("ituser"))
	resp, err := ts.Client().Post(ts.URL+"/auth/register", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /auth/register: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}

	var out struct {
		TinodeUID string `json:"tinodeUid"`
		HashID    string `json:"hashId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !strings.HasPrefix(out.TinodeUID, "usr") {
		t.Fatalf("expected usr-prefixed uid, got %q", out.TinodeUID)
	}
	if !hashIDRe.MatchString(out.HashID) {
		t.Fatalf("expected #NNNNN hash id, got %q", out.HashID)
	}
	t.Logf("registered: uid=%s hashId=%s", out.TinodeUID, out.HashID)
}

// TestRevealAndFriendsStore drives the roulette-match reveal state machine and
// the friends graph against real Postgres (no Tinode needed). It covers:
// match record -> reveal request -> mutual accept -> friends; and the #ID
// friend-request/respond path. Skips when COMPANION_DB_DSN is unset.
func TestRevealAndFriendsStore(t *testing.T) {
	dsn := os.Getenv("COMPANION_DB_DSN")
	if dsn == "" {
		t.Skip("COMPANION_DB_DSN not set; run inside the compose network to reach the db service")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	database, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	st := store.New(database)

	age := 25
	mkUser := func(gender string) store.User {
		u, err := st.CreateUser(ctx, gender, &age, "usrIT"+strconv.FormatInt(time.Now().UnixNano(), 36))
		if err != nil {
			t.Fatalf("create user: %v", err)
		}
		return u
	}
	a := mkUser("male")
	b := mkUser("female")
	topic := "grpIT" + strconv.FormatInt(time.Now().UnixNano(), 36)

	// --- reveal state machine ---
	if _, err := st.CreateMatch(ctx, topic, a.ID, b.ID); err != nil {
		t.Fatalf("create match: %v", err)
	}
	if _, err := st.RequestReveal(ctx, topic, a.ID); err != nil {
		t.Fatalf("request reveal: %v", err)
	}
	// The requester cannot self-complete the reveal.
	if _, err := st.AcceptReveal(ctx, topic, a.ID); err == nil {
		t.Fatal("requester should not be able to accept their own reveal")
	}
	m, err := st.AcceptReveal(ctx, topic, b.ID)
	if err != nil {
		t.Fatalf("accept reveal: %v", err)
	}
	if m.Status != "revealed" {
		t.Fatalf("expected revealed, got %q", m.Status)
	}

	// Reveal makes them friends (both directions).
	if err := st.MarkFriends(ctx, a.ID, b.ID, "reveal"); err != nil {
		t.Fatalf("mark friends: %v", err)
	}
	assertFriend(t, ctx, st, a.ID, b.ID)
	assertFriend(t, ctx, st, b.ID, a.ID)

	// Recent-partner exclusion sees the pairing.
	recent, err := st.RecentPartnerIDs(ctx, a.ID, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("recent partners: %v", err)
	}
	if !recent[b.ID] {
		t.Fatalf("expected b in a's recent partners")
	}

	// --- friend request by #ID ---
	c := mkUser("male")
	if err := st.CreateFriendRequest(ctx, c.ID, a.ID, "search"); err != nil {
		t.Fatalf("create friend request: %v", err)
	}
	pending, err := st.PendingFriendRequests(ctx, a.ID)
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	if len(pending) != 1 || pending[0].UserID != c.ID {
		t.Fatalf("expected one pending request from c, got %+v", pending)
	}
	uid, err := st.RespondFriendRequest(ctx, a.ID, c.ID, true)
	if err != nil {
		t.Fatalf("respond: %v", err)
	}
	if uid == "" {
		t.Fatal("expected requester uid on accept")
	}
	assertFriend(t, ctx, st, a.ID, c.ID)
	t.Logf("reveal+friends store flow OK: a=#%05d b=#%05d c=#%05d", a.HashID, b.HashID, c.HashID)
}

// TestPriorityBySubscriptionTier verifies Store.Priority reads the
// subscriptions table: free (no row) is priority 0, premium/super_premium are
// higher, and a lapsed (expired) paid tier falls back to free. Skips when
// COMPANION_DB_DSN is unset.
func TestPriorityBySubscriptionTier(t *testing.T) {
	dsn := os.Getenv("COMPANION_DB_DSN")
	if dsn == "" {
		t.Skip("COMPANION_DB_DSN not set; run inside the compose network to reach the db service")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	database, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	st := store.New(database)

	age := 30
	mkUser := func() store.User {
		u, err := st.CreateUser(ctx, "male", &age, "usrIT"+strconv.FormatInt(time.Now().UnixNano(), 36))
		if err != nil {
			t.Fatalf("create user: %v", err)
		}
		return u
	}

	free := mkUser()
	if p, err := st.Priority(ctx, free.ID); err != nil || p != 0 {
		t.Fatalf("free user (no subscriptions row): priority=%d err=%v, want 0/nil", p, err)
	}

	premium := mkUser()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO subscriptions (user_id, tier) VALUES ($1, 'premium')`, premium.ID); err != nil {
		t.Fatalf("insert premium subscription: %v", err)
	}
	if p, err := st.Priority(ctx, premium.ID); err != nil || p <= 0 {
		t.Fatalf("premium user: priority=%d err=%v, want >0", p, err)
	}

	superPremium := mkUser()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO subscriptions (user_id, tier) VALUES ($1, 'super_premium')`, superPremium.ID); err != nil {
		t.Fatalf("insert super_premium subscription: %v", err)
	}
	pPremium, _ := st.Priority(ctx, premium.ID)
	pSuper, err := st.Priority(ctx, superPremium.ID)
	if err != nil || pSuper <= pPremium {
		t.Fatalf("super_premium priority=%d should exceed premium priority=%d (err=%v)", pSuper, pPremium, err)
	}

	lapsed := mkUser()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO subscriptions (user_id, tier, expires_at) VALUES ($1, 'premium', now() - interval '1 hour')`,
		lapsed.ID); err != nil {
		t.Fatalf("insert lapsed subscription: %v", err)
	}
	if p, err := st.Priority(ctx, lapsed.ID); err != nil || p != 0 {
		t.Fatalf("lapsed premium user: priority=%d err=%v, want 0/nil (fallback to free)", p, err)
	}
}

// TestLeavingARevealedMatchClearsCurrent covers the #24 fix: a revealed match
// keeps its status forever (Match.Anon() reads it, so ending the row would
// re-anonymise two friends), which used to make CurrentMatchForUser report that
// pairing as the caller's "current" match indefinitely — the frontend had to
// guard against its own backend. Leaving now records left_a/left_b, and this
// lookup drops rows the caller has left.
//
// The peer's view is asserted too: one person walking out must not hide the
// chat from the other, who may still be sitting in it.
func TestLeavingARevealedMatchClearsCurrent(t *testing.T) {
	dsn := os.Getenv("COMPANION_DB_DSN")
	if dsn == "" {
		t.Skip("COMPANION_DB_DSN not set; run inside the compose network to reach the db service")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	database, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	st := store.New(database)

	age := 25
	mkUser := func(gender string) store.User {
		u, err := st.CreateUser(ctx, gender, &age, "usrIT"+strconv.FormatInt(time.Now().UnixNano(), 36))
		if err != nil {
			t.Fatalf("create user: %v", err)
		}
		return u
	}
	a := mkUser("male")
	b := mkUser("female")
	topic := "grpIT" + strconv.FormatInt(time.Now().UnixNano(), 36)

	if _, err := st.CreateMatch(ctx, topic, a.ID, b.ID); err != nil {
		t.Fatalf("create match: %v", err)
	}
	if _, err := st.RequestReveal(ctx, topic, a.ID); err != nil {
		t.Fatalf("request reveal: %v", err)
	}
	if _, err := st.AcceptReveal(ctx, topic, b.ID); err != nil {
		t.Fatalf("accept reveal: %v", err)
	}

	// Still in the chat: both sides see it as current.
	for _, u := range []store.User{a, b} {
		m, err := st.CurrentMatchForUser(ctx, u.ID)
		if err != nil {
			t.Fatalf("current match for %d right after reveal: %v", u.ID, err)
		}
		if m.Topic != topic {
			t.Fatalf("current match for %d = %q, want %q", u.ID, m.Topic, topic)
		}
	}

	if err := st.LeaveMatch(ctx, topic, a.ID); err != nil {
		t.Fatalf("leave match: %v", err)
	}

	// A has walked out — the revealed row must no longer be their current match.
	if m, err := st.CurrentMatchForUser(ctx, a.ID); !errors.Is(err, store.ErrNoMatch) {
		t.Fatalf("after leaving, current match for a = (%+v, %v), want ErrNoMatch", m, err)
	}
	// The row itself is untouched: status stays 'revealed' so relays keep
	// naming the pair as friends rather than falling back to anon aliases.
	m, err := st.MatchByTopic(ctx, topic)
	if err != nil {
		t.Fatalf("match by topic after leave: %v", err)
	}
	if m.Status != "revealed" {
		t.Fatalf("status after leave = %q, want revealed (ending it would re-anonymise the pair)", m.Status)
	}
	// B never left, so B still sees it.
	if m, err := st.CurrentMatchForUser(ctx, b.ID); err != nil || m.Topic != topic {
		t.Fatalf("b should still be in the chat: (%+v, %v)", m, err)
	}

	// Idempotent: leaving twice keeps the first timestamp and stays cleared.
	if err := st.LeaveMatch(ctx, topic, a.ID); err != nil {
		t.Fatalf("second leave: %v", err)
	}
	if _, err := st.CurrentMatchForUser(ctx, a.ID); !errors.Is(err, store.ErrNoMatch) {
		t.Fatalf("after a second leave, a should still have no current match: %v", err)
	}
	t.Logf("revealed-match leave OK: a=#%05d b=#%05d topic=%s", a.HashID, b.HashID, topic)
}

// assertFriend fails unless friend is in user's accepted friends list.
func assertFriend(t *testing.T, ctx context.Context, st *store.Store, userID, friendID int64) {
	t.Helper()
	friends, err := st.Friends(ctx, userID)
	if err != nil {
		t.Fatalf("friends(%d): %v", userID, err)
	}
	for _, f := range friends {
		if f.UserID == friendID {
			return
		}
	}
	t.Fatalf("user %d should have friend %d; got %+v", userID, friendID, friends)
}
