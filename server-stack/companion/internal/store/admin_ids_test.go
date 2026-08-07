package store

import (
	"context"
	"database/sql/driver"
	"strings"
	"testing"
	"time"
)

// reportRowValues is one well-formed report row for the recording driver, in
// the column order reportSelect scans. Its first column doubles as the value the
// count query scans, which is what lets one configured row serve both statements
// ListReports issues.
func reportRowValues() (cols []string, rows [][]driver.Value) {
	return []string{
			"id", "reporter_id", "reporter_hash", "reported_id", "target_hash",
			"category", "topic", "details", "status", "created_at", "resolved_at",
		}, [][]driver.Value{{
			int64(1), int64(2), int64(11), int64(3), int64(12),
			"spam", "", "", "open", time.Now(), nil,
		}}
}

// TestListReportsBindsIDsAsParameters covers the `ids` set (getMany,
// COMPANION-ADMIN-API.md §1): every id must travel as a $N parameter, and the
// placeholders must be numbered after the filter args that precede them —
// getting that wrong silently shifts LIMIT/OFFSET onto an id.
func TestListReportsBindsIDsAsParameters(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols, rec.rows = reportRowValues()

	if _, _, err := st.ListReports(context.Background(), ListParams{
		Limit: 25, IDs: []int64{3, 7},
	}); err != nil {
		t.Fatalf("ListReports: %v", err)
	}
	if n := rec.count(); n != 2 {
		t.Fatalf("expected count + list statements, got %d: %+v", n, rec.stmts)
	}

	list := rec.stmts[1]
	if !strings.Contains(list.query, "r.id IN ($2, $3)") {
		t.Errorf("ids are not bound as parameters — query was:\n%s", list.query)
	}
	if !strings.Contains(list.query, "LIMIT $4 OFFSET $5") {
		t.Errorf("pagination placeholders collide with the id set — query was:\n%s", list.query)
	}
	want := []driver.Value{"", int64(3), int64(7), int64(25), int64(0)}
	if len(list.args) != len(want) {
		t.Fatalf("args = %v, want %v", list.args, want)
	}
	for i := range want {
		if list.args[i] != want[i] {
			t.Fatalf("args = %v, want %v", list.args, want)
		}
	}
}

// TestListBansWithEmptyIDSetMatchesNothing is the distinction ListParams.IDs
// exists for: "ids=" that resolves to nothing was still a request for a specific
// set, so the answer is no rows. Falling back to an unfiltered page would turn a
// getMany of one deleted row into a dump of the whole table.
// (Nothing here interprets SQL — the driver replays whatever row the test
// configured — so the property is checked on the statement, not on the count.)
func TestListBansWithEmptyIDSetMatchesNothing(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"id", "user_id", "hash_id", "reason", "permanent", "expires_at", "status", "created_at"}
	rec.rows = [][]driver.Value{{int64(1), int64(2), int64(11), "spam", false, nil, "active", time.Now()}}

	if _, _, err := st.ListBans(context.Background(), ListParams{Limit: 25, IDs: []int64{}}); err != nil {
		t.Fatalf("ListBans: %v", err)
	}

	count := rec.stmts[0].query
	if !strings.Contains(count, "false") || strings.Contains(count, "IN (") {
		t.Errorf("an empty id set did not narrow the query — query was:\n%s", count)
	}
}

// TestListUsersWithoutIDsIsUnrestricted: a plain page must not grow an id
// predicate (nil IDs is "no restriction", the ordinary listing path).
func TestListUsersWithoutIDsIsUnrestricted(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{
		"id", "hash_id", "gender", "real_gender", "state", "age", "last_seen",
		"deleted_at", "created_at", "reports", "banned", "muted",
	}
	rec.rows = [][]driver.Value{{
		int64(1), int64(11), "male", nil, "ok", nil, nil, nil, time.Now(), int64(0), false, false,
	}}

	if _, _, err := st.ListUsers(context.Background(), ListParams{Limit: 25}); err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if q := rec.stmts[0].query; strings.Contains(q, "u.id IN") || strings.Contains(q, "false") {
		t.Errorf("nil IDs restricted the listing — query was:\n%s", q)
	}
}
