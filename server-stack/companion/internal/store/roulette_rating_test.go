package store

import (
	"context"
	"database/sql/driver"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// TestRateMatchIsIdempotentAndDerived pins both halves of the S3 fix. The old
// AddRating incremented users.rating_sum/rating_count in place, so replaying
// POST /roulette/rate accumulated without bound; membership said "you were in
// this chat", which is not "you may score this person again".
//
// The replacement has to do two things and this checks both: key the rating on
// (match, rater) so a replay overwrites its own row, and RECOMPUTE the running
// totals from the ledger rather than adding to them — a sum that is derived
// cannot drift no matter how the endpoint is called.
func TestRateMatchIsIdempotentAndDerived(t *testing.T) {
	st, rec := newRecordingStore(t)

	if err := st.RateMatch(context.Background(), 3, 11, 22, 5); err != nil {
		t.Fatalf("RateMatch: %v", err)
	}

	rec.mu.Lock()
	stmts := append([]recordedStmt(nil), rec.stmts...)
	rec.mu.Unlock()
	if len(stmts) != 2 {
		t.Fatalf("expected the insert and the recompute, got %d statements: %+v", len(stmts), stmts)
	}

	insert, recompute := stmts[0], stmts[1]

	if !strings.Contains(insert.query, "ON CONFLICT (match_id, rater_id)") {
		t.Errorf("rating is not keyed per (match, rater) — a replay would add a row:\n%s", insert.query)
	}
	if !strings.Contains(insert.query, "DO UPDATE SET rating = EXCLUDED.rating") {
		t.Errorf("a replay does not revise the existing vote:\n%s", insert.query)
	}
	wantInsert := []driver.Value{int64(3), int64(11), int64(22), int64(5)}
	if !reflect.DeepEqual(insert.args, wantInsert) {
		t.Errorf("insert args = %+v, want %+v", insert.args, wantInsert)
	}

	// The distinction that matters: assignment from a subquery, not `+ $2`.
	if strings.Contains(recompute.query, "rating_sum + ") || strings.Contains(recompute.query, "rating_count + ") {
		t.Errorf("totals are still incremented rather than derived:\n%s", recompute.query)
	}
	if !strings.Contains(recompute.query, "FROM roulette_ratings") {
		t.Errorf("totals are not recomputed from the ledger:\n%s", recompute.query)
	}
	if want := []driver.Value{int64(22)}; !reflect.DeepEqual(recompute.args, want) {
		t.Errorf("recompute args = %+v, want %+v (the RATED user)", recompute.args, want)
	}
}

// TestRateMatchRejectsBadInput covers the guards that keep a malformed call from
// reaching the table at all — the CHECK constraints exist too, but a 500 from a
// constraint violation is a worse answer than a refusal.
func TestRateMatchRejectsBadInput(t *testing.T) {
	tests := []struct {
		name                      string
		matchID, raterID, ratedID int64
		rating                    int
	}{
		{"rating below range", 3, 11, 22, 0},
		{"rating above range", 3, 11, 22, 6},
		{"rating yourself", 3, 11, 11, 5},
		{"missing rater", 3, 0, 22, 5},
		{"missing rated", 3, 11, 0, 5},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st, rec := newRecordingStore(t)
			if err := st.RateMatch(context.Background(), tc.matchID, tc.raterID, tc.ratedID, tc.rating); err == nil {
				t.Error("expected a refusal")
			}
			if n := rec.count(); n != 0 {
				t.Errorf("issued %d statements for a rejected rating, want none", n)
			}
		})
	}
}

// TestLiveMatchBetweenSpansRevealed guards the clause that the #ID relay branch
// leans on. The fallback originally asked ActiveMatchForUser, whose
// `status = 'active'` filter excludes a revealed match — which is precisely the
// state the fallback exists for, since it covers a reveal whose best-effort
// MarkFriends write lost. The lookup must therefore span active AND revealed,
// and must still exclude ended (that is S5's boundary).
func TestLiveMatchBetweenSpansRevealed(t *testing.T) {
	st, rec := newRecordingStore(t)
	rec.cols = []string{"id", "topic", "user_a", "user_b", "status", "reveal_by", "reveal_declined_by", "reveal_declines_a", "reveal_declines_b", "alias_a", "alias_b"}
	rec.rows = [][]driver.Value{{int64(3), "grpX", int64(11), int64(22), "revealed", nil, nil, int64(0), int64(0), "~AAAAAA", "~BBBBBB"}}

	m, err := st.LiveMatchBetween(context.Background(), 11, 22)
	if err != nil {
		t.Fatalf("LiveMatchBetween: %v", err)
	}
	if m.Status != "revealed" || m.Peer(11) != 22 {
		t.Errorf("resolved %+v, want the revealed pairing with peer 22", m)
	}

	stmt := rec.only(t)
	if !strings.Contains(stmt.query, "status <> 'ended'") {
		t.Errorf("lookup does not exclude ended matches (S5 boundary):\n%s", stmt.query)
	}
	if strings.Contains(stmt.query, "status = 'active'") {
		t.Errorf("lookup still excludes revealed matches — the bug this replaced:\n%s", stmt.query)
	}
	// Either ordering of the pair has to match: user_a/user_b is assignment
	// order from the matcher, not anything the caller controls.
	if !strings.Contains(stmt.query, "user_a = $1 AND user_b = $2") ||
		!strings.Contains(stmt.query, "user_a = $2 AND user_b = $1") {
		t.Errorf("lookup is not symmetric in the pair:\n%s", stmt.query)
	}
	if want := []driver.Value{int64(11), int64(22)}; !reflect.DeepEqual(stmt.args, want) {
		t.Errorf("args = %+v, want %+v", stmt.args, want)
	}
}

// TestLiveMatchBetweenRejectsDegenerateInput: a zero id is what a missed
// membership check looks like, and it must not be answered with somebody's row.
func TestLiveMatchBetweenRejectsDegenerateInput(t *testing.T) {
	for _, tc := range []struct{ a, b int64 }{{0, 22}, {11, 0}, {11, 11}} {
		st, rec := newRecordingStore(t)
		if _, err := st.LiveMatchBetween(context.Background(), tc.a, tc.b); !errors.Is(err, ErrNoMatch) {
			t.Errorf("LiveMatchBetween(%d, %d) = %v, want ErrNoMatch", tc.a, tc.b, err)
		}
		if n := rec.count(); n != 0 {
			t.Errorf("LiveMatchBetween(%d, %d) issued %d statements, want none", tc.a, tc.b, n)
		}
	}
}
