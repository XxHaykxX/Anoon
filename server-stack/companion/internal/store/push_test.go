package store

import (
	"context"
	"database/sql/driver"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// TestSavePushSubscriptionRequiresProofOfPossession covers the takeover guard.
// An endpoint is not a secret we control, so possession of the string must not
// be enough to move somebody else's subscription onto your account — that
// silently stops every notification they should have received.
//
// What a test without a live Postgres can pin is the two halves the guard is
// made of: that the statement carries the ownership condition with the keys as
// parameters (the server evaluates it), and that the store maps "no row came
// back" — what the conditional upsert produces when the guard rejects the write
// — to a refusal rather than to success.
func TestSavePushSubscriptionRequiresProofOfPossession(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"id"} // no rows: the WHERE rejected the takeover

	const endpoint = "https://push.example/subscription/abc"
	err := st.SavePushSubscription(context.Background(), 7, endpoint, "victim-p256dh", "victim-auth")
	if !errors.Is(err, ErrSubscriptionOwned) {
		t.Fatalf("takeover with wrong keys returned %v, want ErrSubscriptionOwned", err)
	}

	stmt := rec.only(t)
	if !strings.Contains(stmt.query, "push_subscriptions.user_id = EXCLUDED.user_id") {
		t.Errorf("upsert does not allow the owner through — query was:\n%s", stmt.query)
	}
	if !strings.Contains(stmt.query, "push_subscriptions.p256dh = EXCLUDED.p256dh") ||
		!strings.Contains(stmt.query, "push_subscriptions.auth = EXCLUDED.auth") {
		t.Errorf("upsert does not demand the stored keys — query was:\n%s", stmt.query)
	}
	if !strings.Contains(stmt.query, "RETURNING id") {
		t.Errorf("without RETURNING, a rejected takeover is indistinguishable from success:\n%s", stmt.query)
	}
	want := []driver.Value{int64(7), endpoint, "victim-p256dh", "victim-auth"}
	if !reflect.DeepEqual(stmt.args, want) {
		t.Errorf("args = %+v, want %+v", stmt.args, want)
	}
}

// TestSavePushSubscriptionAcceptsOwnDevice is the other side of the guard: when
// the write is allowed (own row, or matching keys on a shared device) a row
// comes back and the subscribe succeeds. Without this, "refuse everything"
// would pass the test above.
func TestSavePushSubscriptionAcceptsOwnDevice(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"id"}
	rec.rows = [][]driver.Value{{int64(42)}}

	if err := st.SavePushSubscription(context.Background(), 7,
		"https://push.example/subscription/abc", "my-p256dh", "my-auth"); err != nil {
		t.Fatalf("SavePushSubscription for an allowed write: %v", err)
	}
}

// TestDeletePushSubscriptionOfIsUserScoped pins the binding that stops one user
// unsubscribing another. An endpoint is not a secret we control — it is handed
// to the push service and quoted in logs — so the caller's id, not possession
// of the endpoint, is what authorizes the delete.
func TestDeletePushSubscriptionOfIsUserScoped(t *testing.T) {
	st, rec := newRecordingStore(t)

	const endpoint = "https://push.example/subscription/abc"
	if err := st.DeletePushSubscriptionOf(context.Background(), 7, endpoint); err != nil {
		t.Fatalf("DeletePushSubscriptionOf: %v", err)
	}

	stmt := rec.only(t)
	if !strings.Contains(stmt.query, "user_id = $2") {
		t.Errorf("delete is not scoped to the caller — query was:\n%s", stmt.query)
	}
	if !strings.Contains(stmt.query, "endpoint = $1") {
		t.Errorf("delete does not select the endpoint — query was:\n%s", stmt.query)
	}
	want := []driver.Value{endpoint, int64(7)}
	if !reflect.DeepEqual(stmt.args, want) {
		t.Errorf("args = %+v, want %+v", stmt.args, want)
	}
	// Same query, another caller: the id travels as a parameter, so a request
	// naming somebody else's endpoint simply matches no row.
	if strings.Contains(stmt.query, endpoint) {
		t.Errorf("endpoint was concatenated into the SQL:\n%s", stmt.query)
	}
}

// TestDeletePushSubscriptionStaysUnscoped guards the other caller: the push
// sender drops a subscription the push service reported as gone (404/410),
// where the endpoint comes from our own table and belongs to whoever it
// belongs to. That path must keep working without a user id.
func TestDeletePushSubscriptionStaysUnscoped(t *testing.T) {
	st, rec := newRecordingStore(t)

	if err := st.DeletePushSubscription(context.Background(), "https://push.example/gone"); err != nil {
		t.Fatalf("DeletePushSubscription: %v", err)
	}
	if stmt := rec.only(t); strings.Contains(stmt.query, "user_id") {
		t.Errorf("stale-subscription sweep should not filter on user_id — query was:\n%s", stmt.query)
	}
}
