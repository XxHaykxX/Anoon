package store

import "testing"

// me is the caller in every case below; them is the other party.
const (
	me   int64 = 11
	them int64 = 12
)

// TestApplyRelationRow covers the mapping from a single friendships row to a
// relation. These branches cannot be reached by observation — the live DB holds
// only 'accepted' rows — so the table below is the only thing pinning them.
func TestApplyRelationRow(t *testing.T) {
	tests := []struct {
		name             string
		userID, friendID int64 // the row, as stored (user_id -> friend_id)
		status           string
		want             Relation
	}{
		{"accepted, row my direction", me, them, "accepted", RelationFriends},
		{"accepted, row their direction", them, me, "accepted", RelationFriends},
		{"pending I sent", me, them, "pending", RelationRequestSent},
		{"pending they sent", them, me, "pending", RelationRequestReceived},
		{"blocked by me", me, them, "blocked", RelationBlocked},
		{"blocked by them", them, me, "blocked", RelationBlocked},
		{"unknown status is ignored", me, them, "wat", RelationNone},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := applyRelationRow(RelationNone, me, tc.userID, tc.friendID, tc.status)
			if got != tc.want {
				t.Errorf("applyRelationRow(none, %d, %d, %d, %q) = %q, want %q",
					me, tc.userID, tc.friendID, tc.status, got, tc.want)
			}
		})
	}
}

// TestApplyRelationRowPrecedence checks that folding a pair's rows in EITHER
// order yields the same relation. Rows come back unordered and a pair can
// legitimately have two (accept writes both directions; two people can request
// each other), so order-independence is a correctness property, not a nicety.
func TestApplyRelationRowPrecedence(t *testing.T) {
	type row struct {
		userID, friendID int64
		status           string
	}
	sentByMe := row{me, them, "pending"}
	sentByThem := row{them, me, "pending"}
	acceptedMine := row{me, them, "accepted"}
	acceptedTheirs := row{them, me, "accepted"}
	blockedByMe := row{me, them, "blocked"}
	blockedByThem := row{them, me, "blocked"}

	tests := []struct {
		name string
		a, b row
		want Relation
	}{
		{"both directions accepted", acceptedMine, acceptedTheirs, RelationFriends},
		{"accepted beats a stale pending", acceptedMine, sentByThem, RelationFriends},
		{"mutual requests resolve to received", sentByMe, sentByThem, RelationRequestReceived},
		{"block beats friendship", acceptedMine, blockedByThem, RelationBlocked},
		{"block beats a pending request", sentByMe, blockedByMe, RelationBlocked},
		{"their block beats my friendship", acceptedMine, blockedByThem, RelationBlocked},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fold := func(rows ...row) Relation {
				out := RelationNone
				for _, r := range rows {
					out = applyRelationRow(out, me, r.userID, r.friendID, r.status)
				}
				return out
			}
			forward, reverse := fold(tc.a, tc.b), fold(tc.b, tc.a)
			if forward != reverse {
				t.Fatalf("order-dependent: forward = %q, reverse = %q", forward, reverse)
			}
			if forward != tc.want {
				t.Errorf("folded = %q, want %q", forward, tc.want)
			}
		})
	}
}

// TestRelationRankTotalOrder guards the ranking itself: every relation that can
// come from a row must have a distinct rank, or precedence becomes arbitrary
// between two equally-ranked values.
func TestRelationRankTotalOrder(t *testing.T) {
	ordered := []Relation{
		RelationNone,
		RelationRequestSent,
		RelationRequestReceived,
		RelationFriends,
		RelationBlocked,
	}
	for i := 1; i < len(ordered); i++ {
		if relationRank(ordered[i]) <= relationRank(ordered[i-1]) {
			t.Errorf("rank(%q)=%d must exceed rank(%q)=%d",
				ordered[i], relationRank(ordered[i]), ordered[i-1], relationRank(ordered[i-1]))
		}
	}
}

// TestRelationsSelf covers the one Relations branch that needs no database: the
// caller searching for their own id. It must not be dropped from the result and
// must not be looked up as a friendship.
func TestRelationsSelf(t *testing.T) {
	s := &Store{}
	out, err := s.Relations(nil, me, []int64{me})
	if err != nil {
		t.Fatalf("Relations for self: %v", err)
	}
	if got := out[me]; got != RelationSelf {
		t.Errorf("Relations(me, [me])[me] = %q, want %q", got, RelationSelf)
	}
}

// TestRelationsNoLookups checks the other no-DB early return: an id list with
// nothing to resolve must not reach the database (s.db is nil here, so a query
// would panic).
func TestRelationsNoLookups(t *testing.T) {
	s := &Store{}
	for _, ids := range [][]int64{nil, {}, {0}, {me, me}} {
		out, err := s.Relations(nil, me, ids)
		if err != nil {
			t.Fatalf("Relations(%v): %v", ids, err)
		}
		for id, rel := range out {
			if id == me && rel != RelationSelf {
				t.Errorf("Relations(%v)[%d] = %q, want %q", ids, id, rel, RelationSelf)
			}
		}
	}
}
