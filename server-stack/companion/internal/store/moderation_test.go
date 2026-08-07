package store

import (
	"context"
	"database/sql/driver"
	"strings"
	"testing"
)

// TestDueBansSkipsUsersStillBanned pins the guard that makes ban expiry safe to
// run against overlapping rows. BanUser does not refuse a second active ban, so
// "temp ban, then permanent ban" is reachable — and without the NOT EXISTS the
// temp one lapsing would hand the sweep a user whose permanent ban is still in
// force, whose Tinode suspension it would then lift.
func TestDueBansSkipsUsersStillBanned(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"user_id", "tinode_uid"}
	rec.rows = [][]driver.Value{{int64(7), "usr7"}}

	due, err := st.DueBans(context.Background())
	if err != nil {
		t.Fatalf("DueBans: %v", err)
	}
	if len(due) != 1 || due[0].UserID != 7 || due[0].TinodeUID != "usr7" {
		t.Fatalf("DueBans returned %+v, want one row {7, usr7}", due)
	}

	q := rec.only(t).query
	for _, want := range []string{
		"NOT EXISTS",                       // another ban still in force excludes the user
		"o.expires_at IS NULL",             // ...including a permanent one
		"b.expires_at <= now()",            // only bans that have actually lapsed
		"b.status = 'active'",              // ...and are not already retired
		"JOIN users u ON u.id = b.user_id", // uid comes with the row, not a second query
	} {
		if !strings.Contains(q, want) {
			t.Errorf("DueBans query is missing %q — query was:\n%s", want, q)
		}
	}
}

// TestExpireBanForRegardsOtherActiveBans covers the same overlap one layer down:
// DueBans filters those users out, but a permanent ban landing between the two
// calls must not be undone by the temp ban's expiry, so the user row and the
// journal entry carry their own guard. The ban flip itself must stay narrow —
// only rows that are temporary AND lapsed.
func TestExpireBanForRegardsOtherActiveBans(t *testing.T) {
	st, rec := newRecordingStore(t)

	if err := st.ExpireBanFor(context.Background(), 7); err != nil {
		t.Fatalf("ExpireBanFor: %v", err)
	}
	if n := rec.count(); n != 3 {
		t.Fatalf("expected 3 statements (bans, users, journal), got %d: %+v", n, rec.stmts)
	}

	banFlip, userRow, journal := rec.stmts[0], rec.stmts[1], rec.stmts[2]
	if !strings.Contains(banFlip.query, "expires_at IS NOT NULL") ||
		!strings.Contains(banFlip.query, "expires_at <= now()") {
		t.Errorf("the ban flip is not limited to lapsed temporary bans — query was:\n%s", banFlip.query)
	}
	for _, stmt := range []recordedStmt{userRow, journal} {
		if !strings.Contains(stmt.query, "NOT EXISTS (SELECT 1 FROM bans WHERE user_id = $1 AND status = 'active')") {
			t.Errorf("statement lifts the user while another ban may still be active — query was:\n%s", stmt.query)
		}
	}
	for _, stmt := range rec.stmts {
		if len(stmt.args) != 1 || stmt.args[0] != int64(7) {
			t.Errorf("expected the user id as the only bound parameter, got %v in:\n%s", stmt.args, stmt.query)
		}
	}
}
