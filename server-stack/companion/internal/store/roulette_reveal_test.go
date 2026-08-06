package store

import (
	"context"
	"database/sql/driver"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// matchRow configures the recording driver to answer MatchByTopic with one
// pairing: id 3, users 11 and 22, in the given status, with revealBy pending.
func matchRow(rec *recorder, status string, revealBy any) {
	matchRowDeclined(rec, status, revealBy, nil)
}

// matchRowDeclined is matchRow with reveal_declined_by set — the state a match
// is left in after somebody turns a request down.
func matchRowDeclined(rec *recorder, status string, revealBy, declinedBy any) {
	matchRowFull(rec, status, revealBy, declinedBy, 0, 0)
}

// matchRowFull additionally sets each member's spent-ask counts (user 11 is
// side A, user 22 is side B).
func matchRowFull(rec *recorder, status string, revealBy, declinedBy any, declinesA, declinesB int64) {
	rec.cols = []string{"id", "user_a", "user_b", "status", "reveal_by", "reveal_declined_by",
		"reveal_declines_a", "reveal_declines_b", "alias_a", "alias_b"}
	rec.rows = [][]driver.Value{{int64(3), int64(11), int64(22), status, revealBy, declinedBy,
		declinesA, declinesB, "~AAAAAA", "~BBBBBB"}}
}

// TestDeclineRevealClearsThePendingRequest is the fix for the wedge. Declining
// used to touch nothing at all, which left reveal_by naming the requester
// forever. RequestReveal only writes `WHERE reveal_by IS NULL`, so the person
// who declined could never successfully ask in return, and the original
// requester could never accept if they did — AcceptReveal refuses an accept
// from whoever reveal_by names. Clearing the field is what makes "a decline is
// not final" true rather than aspirational.
func TestDeclineRevealClearsThePendingRequest(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", int64(11)) // user 11 asked

	requester, err := st.DeclineReveal(context.Background(), "grpX", 22)
	if err != nil {
		t.Fatalf("DeclineReveal: %v", err)
	}
	if requester != 11 {
		t.Errorf("requester = %d, want 11 (who gets the reveal_declined frame)", requester)
	}

	rec.mu.Lock()
	stmts := append([]recordedStmt(nil), rec.stmts...)
	rec.mu.Unlock()
	if len(stmts) != 2 {
		t.Fatalf("expected the lookup and the clear, got %d: %+v", len(stmts), stmts)
	}

	clear := stmts[1]
	if !strings.Contains(clear.query, "reveal_by = NULL") {
		t.Errorf("decline does not clear the pending request — re-asking stays wedged:\n%s", clear.query)
	}
	if !strings.Contains(clear.query, "status = 'active'") {
		t.Errorf("decline is not scoped to a live match:\n%s", clear.query)
	}
	// Scoped to the requester, so a decline racing an accept cannot wipe a
	// request that has meanwhile been replaced.
	if !strings.Contains(clear.query, "reveal_by = $2") {
		t.Errorf("clear is not scoped to the request being declined:\n%s", clear.query)
	}
	// topic, the request being declined, and who declined it — see
	// TestDeclineRevealRecordsTheDecliner for why the third one matters.
	if want := []driver.Value{"grpX", int64(11), int64(22)}; !reflect.DeepEqual(clear.args, want) {
		t.Errorf("args = %+v, want %+v", clear.args, want)
	}
}

// TestDeclineRevealIsIdempotent: a double-fired decline (StrictMode, a retry)
// must not error, and must report nobody to notify the second time.
func TestDeclineRevealIsIdempotent(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", nil) // nothing pending any more

	requester, err := st.DeclineReveal(context.Background(), "grpX", 22)
	if err != nil {
		t.Fatalf("DeclineReveal with nothing pending: %v", err)
	}
	if requester != 0 {
		t.Errorf("requester = %d, want 0 (no frame to send)", requester)
	}
	if n := rec.count(); n != 1 {
		t.Errorf("issued %d statements, want just the lookup", n)
	}
}

// TestDeclineRevealRejectsNonMembers is the anti-spoof rule. The decline path
// now emits a frame, so a stranger naming somebody else's topic must not be
// able to fake "your peer said no" at them.
func TestDeclineRevealRejectsNonMembers(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", int64(11))

	if _, err := st.DeclineReveal(context.Background(), "grpX", 99); !errors.Is(err, ErrNoMatch) {
		t.Errorf("a non-member declining got %v, want ErrNoMatch", err)
	}
	if n := rec.count(); n != 1 {
		t.Errorf("issued %d statements for a rejected decline, want just the lookup", n)
	}
}

// TestDeclineRevealRefusesDecliningYourOwnRequest: the requester cancelling
// their own ask is a different operation from the peer saying no, and must not
// send anyone a reveal_declined.
func TestDeclineRevealRefusesDecliningYourOwnRequest(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", int64(11))

	requester, err := st.DeclineReveal(context.Background(), "grpX", 11)
	if err != nil {
		t.Fatalf("DeclineReveal: %v", err)
	}
	if requester != 0 {
		t.Errorf("requester = %d, want 0", requester)
	}
	if n := rec.count(); n != 1 {
		t.Errorf("issued %d statements, want just the lookup", n)
	}
}

// TestRequestRevealReportsTheStoredPendingState covers the silent lie that made
// the wedge invisible: when the UPDATE matches nothing because a request is
// already pending, the returned Match must carry the STORED reveal_by, not the
// caller's id. AcceptReveal reads that field to decide who may accept, so
// returning the wrong one turns "who asked?" into a coin flip.
func TestRequestRevealReportsTheStoredPendingState(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", int64(11)) // user 11 already asked
	rec.affected = 0                   // so user 22's request writes nothing

	m, err := st.RequestReveal(context.Background(), "grpX", 22)
	if err != nil {
		t.Fatalf("RequestReveal: %v", err)
	}
	if m.RevealBy != 11 {
		t.Errorf("RevealBy = %d, want 11 — the request that is actually stored", m.RevealBy)
	}
}

// TestRequestRevealTakesTheSlotWhenFree is the ordinary path, and the one that
// proves re-asking works after a decline has cleared the field: with reveal_by
// NULL the UPDATE matches, and the caller becomes the requester.
func TestRequestRevealTakesTheSlotWhenFree(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", nil) // cleared, e.g. by a previous decline
	rec.affected = 1

	m, err := st.RequestReveal(context.Background(), "grpX", 22)
	if err != nil {
		t.Fatalf("RequestReveal after a decline: %v", err)
	}
	if m.RevealBy != 22 {
		t.Errorf("RevealBy = %d, want 22 — re-asking after a decline must be legal", m.RevealBy)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.stmts) != 2 || !strings.Contains(rec.stmts[1].query, "reveal_by IS NULL") {
		t.Errorf("request does not claim a free slot: %+v", rec.stmts)
	}
}

// TestRevealStateForBothSides is the resync contract. Every one of these states
// is otherwise only ever announced over a best-effort socket, so a client that
// was backgrounded at the wrong moment can recover the answer only if the poll
// tells the same story the frame would have.
//
// The decline row is the asymmetric one and the reason the column stores the
// DECLINER: the same match reads "declined" to the person who asked and "none"
// to the person who said no.
func TestRevealStateForBothSides(t *testing.T) {
	const (
		alice int64 = 11 // UserA
		bob   int64 = 22 // UserB
	)
	tests := []struct {
		name               string
		status             string
		revealBy, declined int64
		wantAlice, wantBob string
	}{
		{"nobody has asked", "active", 0, 0, RevealNone, RevealNone},
		{"alice asked", "active", alice, 0, RevealWeRequested, RevealPeerRequested},
		{"bob asked", "active", bob, 0, RevealPeerRequested, RevealWeRequested},
		{"bob declined alice", "active", 0, bob, RevealDeclined, RevealNone},
		{"alice declined bob", "active", 0, alice, RevealNone, RevealDeclined},
		{"alice asked again after being declined", "active", alice, 0, RevealWeRequested, RevealPeerRequested},
		{"revealed beats everything", "revealed", alice, bob, RevealDone, RevealDone},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := Match{
				UserA: alice, UserB: bob, Status: tc.status,
				RevealBy: tc.revealBy, RevealDeclinedBy: tc.declined,
			}
			if got := m.RevealStateFor(alice); got != tc.wantAlice {
				t.Errorf("alice sees %q, want %q", got, tc.wantAlice)
			}
			if got := m.RevealStateFor(bob); got != tc.wantBob {
				t.Errorf("bob sees %q, want %q", got, tc.wantBob)
			}
		})
	}
}

// TestRevealStateForNonMember: a stranger gets nothing, so the field can never
// disclose that two other people are mid-reveal.
func TestRevealStateForNonMember(t *testing.T) {
	m := Match{UserA: 11, UserB: 22, Status: "active", RevealBy: 11, RevealDeclinedBy: 22}
	if got := m.RevealStateFor(99); got != RevealNone {
		t.Errorf("non-member sees %q, want %q", got, RevealNone)
	}
}

// TestDeclineRevealRecordsTheDecliner: the stored value must be who SAID NO, not
// who was refused. Storing the requester instead would invert every reading of
// the column and tell the decliner they had been declined.
func TestDeclineRevealRecordsTheDecliner(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", int64(11)) // user 11 asked; user 22 declines

	if _, err := st.DeclineReveal(context.Background(), "grpX", 22); err != nil {
		t.Fatalf("DeclineReveal: %v", err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	clear := rec.stmts[1]
	if !strings.Contains(clear.query, "reveal_declined_by = $3") {
		t.Errorf("decline does not record who declined:\n%s", clear.query)
	}
	if want := []driver.Value{"grpX", int64(11), int64(22)}; !reflect.DeepEqual(clear.args, want) {
		t.Errorf("args = %+v, want %+v (topic, requester, DECLINER)", clear.args, want)
	}
}

// TestRequestRevealClearsAPreviousDecline: a decline is not final, so a fresh
// ask must supersede it — otherwise the asker's own poll would keep reporting
// "declined" over the request they just made.
func TestRequestRevealClearsAPreviousDecline(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRowDeclined(rec, "active", nil, int64(22)) // 22 declined earlier
	rec.affected = 1

	if _, err := st.RequestReveal(context.Background(), "grpX", 11); err != nil {
		t.Fatalf("RequestReveal: %v", err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if req := rec.stmts[1]; !strings.Contains(req.query, "reveal_declined_by = NULL") {
		t.Errorf("a new request does not clear the previous refusal:\n%s", req.query)
	}
}

// TestRevealAsksLeftIsPerPerson is the core of the "two asks, then no more"
// rule: an allowance is spent by being REFUSED, and only by your own refusals.
// A shared counter would let one person's persistence silence the other, which
// is the opposite of what the limit is for.
func TestRevealAsksLeftIsPerPerson(t *testing.T) {
	const (
		alice int64 = 11 // side A
		bob   int64 = 22 // side B
	)
	tests := []struct {
		name                       string
		declinesA, declinesB       int
		wantAliceLeft, wantBobLeft int
	}{
		{"fresh match", 0, 0, 2, 2},
		{"alice declined once", 1, 0, 1, 2},
		{"alice declined twice — she is done, bob is not", 2, 0, 0, 2},
		{"both spent", 2, 2, 0, 0},
		{"never goes negative", 5, 0, 0, 2},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := Match{UserA: alice, UserB: bob, Status: "active",
				DeclinesA: tc.declinesA, DeclinesB: tc.declinesB}
			if got := m.RevealAsksLeft(alice); got != tc.wantAliceLeft {
				t.Errorf("alice has %d asks left, want %d", got, tc.wantAliceLeft)
			}
			if got := m.RevealAsksLeft(bob); got != tc.wantBobLeft {
				t.Errorf("bob has %d asks left, want %d", got, tc.wantBobLeft)
			}
		})
	}
	// A stranger has no standing in the match at all.
	m := Match{UserA: alice, UserB: bob, Status: "active"}
	if got := m.RevealAsksLeft(99); got != 0 {
		t.Errorf("non-member has %d asks left, want 0", got)
	}
}

// TestRequestRevealRefusesWhenExhausted: the third ask is refused with the
// distinct sentinel, and — the part that matters — writes nothing, so an
// exhausted requester cannot even nudge the peer.
func TestRequestRevealRefusesWhenExhausted(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRowFull(rec, "active", nil, int64(22), 2, 0) // alice (11) already refused twice

	if _, err := st.RequestReveal(context.Background(), "grpX", 11); !errors.Is(err, ErrRevealAsksExhausted) {
		t.Fatalf("third ask returned %v, want ErrRevealAsksExhausted", err)
	}
	if n := rec.count(); n != 1 {
		t.Errorf("issued %d statements for a refused ask, want just the lookup", n)
	}
}

// TestRequestRevealAllowedForThePeerWhoDeclined is the case the rule must NOT
// break: being turned down twice stops ALICE asking, and leaves bob free to ask
// in his own right. Declining "not right now" and warming up later is ordinary,
// and a shared counter would have made bob's own refusals close the door on him.
func TestRequestRevealAllowedForThePeerWhoDeclined(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRowFull(rec, "active", nil, int64(22), 2, 0) // alice exhausted; bob declined her
	rec.affected = 1

	m, err := st.RequestReveal(context.Background(), "grpX", 22)
	if err != nil {
		t.Fatalf("the decliner asking in their own right: %v", err)
	}
	if m.RevealBy != 22 {
		t.Errorf("RevealBy = %d, want 22", m.RevealBy)
	}
}

// TestDeclineRevealSpendsTheRequestersAllowance: the refusal must be charged to
// whoever asked, never to whoever said no. Charging the decliner would mean
// refusing someone twice cost you your own right to ask.
func TestDeclineRevealSpendsTheRequestersAllowance(t *testing.T) {
	st, rec := newRecordingStore(t)
	matchRow(rec, "active", int64(11)) // alice asked, bob declines

	if _, err := st.DeclineReveal(context.Background(), "grpX", 22); err != nil {
		t.Fatalf("DeclineReveal: %v", err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	clear := rec.stmts[1]
	// $2 is the requester, so both CASE arms must key off $2 — keying off $3
	// (the decliner) would charge the wrong person.
	if !strings.Contains(clear.query, "reveal_declines_a + CASE WHEN user_a = $2") ||
		!strings.Contains(clear.query, "reveal_declines_b + CASE WHEN user_b = $2") {
		t.Errorf("refusal is not charged to the requester:\n%s", clear.query)
	}
}
