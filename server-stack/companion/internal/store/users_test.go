package store

import (
	"context"
	"database/sql/driver"
	"strings"
	"testing"
)

func TestFormatHashID(t *testing.T) {
	cases := map[int64]string{
		1:      "#00001",
		42:     "#00042",
		99999:  "#99999",
		100000: "#100000", // overflow widens, no format migration
	}
	for n, want := range cases {
		if got := FormatHashID(n); got != want {
			t.Errorf("FormatHashID(%d) = %q, want %q", n, got, want)
		}
	}
}

// TestLiveUserByIDExcludesDeleted pins the difference between the two id
// lookups, which is a difference in purpose rather than an oversight:
// UserByID must still resolve a deleted account (a report filed before the
// deletion still has to be actionable — a ban reaches the row through it),
// while LiveUserByID is for the paths that resolve someone in order to keep
// TALKING to them.
func TestLiveUserByIDExcludesDeleted(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"tinode_uid", "hash_id", "gender", "age", "state"}
	rec.rows = [][]driver.Value{{"usrX", int64(42), "male", nil, "ok"}}

	if _, err := st.LiveUserByID(context.Background(), 7); err != nil {
		t.Fatalf("LiveUserByID: %v", err)
	}
	if stmt := rec.only(t); !strings.Contains(stmt.query, "deleted_at IS NULL") {
		t.Errorf("LiveUserByID does not exclude deleted accounts — query was:\n%s", stmt.query)
	}
}

// TestUserByIDKeepsResolvingDeleted is the other half, and the reason S7 was not
// "just add the filter": moderation depends on this lookup NOT filtering.
func TestUserByIDKeepsResolvingDeleted(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"tinode_uid", "hash_id", "gender", "age", "state"}
	rec.rows = [][]driver.Value{{"usrX", int64(42), "male", nil, "ok"}}

	if _, err := st.UserByID(context.Background(), 7); err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if stmt := rec.only(t); strings.Contains(stmt.query, "deleted_at") {
		t.Errorf("UserByID filters deleted accounts; that makes a report against "+
			"someone who deleted themselves unbannable — query was:\n%s", stmt.query)
	}
}
