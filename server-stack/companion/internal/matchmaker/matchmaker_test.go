package matchmaker

import (
	"testing"
	"time"
)

func male(id int64, age string, peers ...string) *Entry {
	return &Entry{UserID: id, HashID: id, Gender: Male, AgeRange: age, PeerAgeRanges: peers, EnqueuedAt: time.Now()}
}
func female(id int64, age string, peers ...string) *Entry {
	return &Entry{UserID: id, HashID: id, Gender: Female, AgeRange: age, PeerAgeRanges: peers, EnqueuedAt: time.Now()}
}

func TestMatchOppositeGenderOnly(t *testing.T) {
	m := New(0)
	_ = m.Enqueue(male(1, Age22_25))
	_ = m.Enqueue(male(2, Age22_25))
	if _, ok := m.TryMatch(time.Now()); ok {
		t.Fatal("two males must not match")
	}
	_ = m.Enqueue(female(3, Age22_25))
	got, ok := m.TryMatch(time.Now())
	if !ok {
		t.Fatal("male+female should match")
	}
	// The female (id 3) must be one of the pair.
	if got.A.UserID != 3 && got.B.UserID != 3 {
		t.Fatalf("expected female in pair, got %d+%d", got.A.UserID, got.B.UserID)
	}
	if got.A.Gender == got.B.Gender {
		t.Fatal("matched pair has same gender")
	}
}

func TestMatchAgePreferenceBothDirections(t *testing.T) {
	m := New(0)
	// Male wants only 26-35; female is 36+ -> male's filter rejects.
	_ = m.Enqueue(male(1, Age22_25, Age26_35))
	_ = m.Enqueue(female(2, Age36, Age22_25))
	if _, ok := m.TryMatch(time.Now()); ok {
		t.Fatal("male filter should reject 36+ female")
	}
	// Add a female the male accepts AND who accepts the male.
	_ = m.Enqueue(female(3, Age26_35, Age22_25))
	got, ok := m.TryMatch(time.Now())
	if !ok {
		t.Fatal("mutually acceptable pair should match")
	}
	if !pair(got, 1, 3) {
		t.Fatalf("expected pair 1+3, got %d+%d", got.A.UserID, got.B.UserID)
	}
}

func TestMatchRejectsWhenPeerDoesNotWantMe(t *testing.T) {
	m := New(0)
	// Male accepts anyone; female only wants 26-35 but male is 18-21.
	_ = m.Enqueue(male(1, Age18_21))
	_ = m.Enqueue(female(2, Age26_35, Age26_35))
	if _, ok := m.TryMatch(time.Now()); ok {
		t.Fatal("female's filter should reject 18-21 male")
	}
}

func TestSofteningDropsAgeFilterAfterWait(t *testing.T) {
	soften := 30 * time.Second
	m := New(soften)
	base := time.Now()
	// Strict, incompatible preferences.
	a := male(1, Age18_21, Age18_21)
	a.EnqueuedAt = base
	b := female(2, Age36, Age36)
	b.EnqueuedAt = base
	_ = m.Enqueue(a)
	_ = m.Enqueue(b)

	// Before softening: no match.
	if _, ok := m.TryMatch(base.Add(10 * time.Second)); ok {
		t.Fatal("should not match before soften window")
	}
	// After softening: both relaxed to gender-only -> match.
	got, ok := m.TryMatch(base.Add(31 * time.Second))
	if !ok {
		t.Fatal("should match once softened")
	}
	if !pair(got, 1, 2) {
		t.Fatalf("unexpected pair %d+%d", got.A.UserID, got.B.UserID)
	}
}

func TestExcludeBlocksRepeatOrBlocked(t *testing.T) {
	m := New(0)
	a := male(1, Age22_25)
	a.Exclude = map[int64]bool{2: true} // recently matched / blocked 2
	_ = m.Enqueue(a)
	_ = m.Enqueue(female(2, Age22_25))
	if _, ok := m.TryMatch(time.Now()); ok {
		t.Fatal("excluded peer must not match")
	}
	// A compatible third party still matches.
	_ = m.Enqueue(female(3, Age22_25))
	if _, ok := m.TryMatch(time.Now()); !ok {
		t.Fatal("non-excluded peer should match")
	}
}

func TestPriorityMatchedFirst(t *testing.T) {
	m := New(0)
	// Two eligible females; the higher-priority one should be chosen for the male.
	f1 := female(2, Age22_25)
	f1.Priority = 0
	f1.EnqueuedAt = time.Now().Add(-time.Minute) // waited longer
	f2 := female(3, Age22_25)
	f2.Priority = 10 // paid tier
	_ = m.Enqueue(f1)
	_ = m.Enqueue(f2)
	_ = m.Enqueue(male(1, Age22_25))

	got, ok := m.TryMatch(time.Now())
	if !ok {
		t.Fatal("expected a match")
	}
	if !(pair(got, 1, 3)) {
		t.Fatalf("priority female (3) should be matched first, got %d+%d", got.A.UserID, got.B.UserID)
	}
}

func TestEnqueueDuplicateRejected(t *testing.T) {
	m := New(0)
	if err := m.Enqueue(male(1, Age22_25)); err != nil {
		t.Fatal(err)
	}
	if err := m.Enqueue(male(1, Age26_35)); err != ErrAlreadyQueued {
		t.Fatalf("expected ErrAlreadyQueued, got %v", err)
	}
	if m.Len() != 1 {
		t.Fatalf("queue should hold one entry, got %d", m.Len())
	}
}

func TestCancelRemoves(t *testing.T) {
	m := New(0)
	_ = m.Enqueue(male(1, Age22_25))
	if !m.Cancel(1) {
		t.Fatal("cancel should report removal")
	}
	if m.Contains(1) || m.Len() != 0 {
		t.Fatal("entry should be gone")
	}
	if m.Cancel(1) {
		t.Fatal("second cancel should be a no-op")
	}
}

func TestNoSelfMatchSingleEntry(t *testing.T) {
	m := New(time.Second)
	_ = m.Enqueue(male(1, Age22_25))
	if _, ok := m.TryMatch(time.Now().Add(time.Hour)); ok {
		t.Fatal("a lone entry must never match itself")
	}
}

// pair reports whether the match is exactly {x,y} in any order.
func pair(m Match, x, y int64) bool {
	return (m.A.UserID == x && m.B.UserID == y) || (m.A.UserID == y && m.B.UserID == x)
}

// --- bucketed-path coverage -------------------------------------------------

// TestSameBucketMatch: a searcher whose peer range names exactly the partner's
// own age bucket pairs via a single target-bucket lookup.
func TestSameBucketMatch(t *testing.T) {
	m := New(0)
	_ = m.Enqueue(male(1, Age26_35, Age26_35))
	_ = m.Enqueue(female(2, Age26_35, Age26_35))
	got, ok := m.TryMatch(time.Now())
	if !ok || !pair(got, 1, 2) {
		t.Fatalf("same-bucket pair should match, got ok=%v %d+%d", ok, got.A.UserID, got.B.UserID)
	}
}

// TestCrossAgeBucketViaRange: the searcher's multi-select peer range spans
// several partner age buckets; the right partner is found in a non-first bucket.
func TestCrossAgeBucketViaRange(t *testing.T) {
	m := New(0)
	// Male accepts 18-21 OR 36+; the only compatible female is 36+.
	male1 := male(1, Age22_25, Age18_21, Age36)
	fem := female(2, Age36, Age22_25)
	_ = m.Enqueue(male1)
	_ = m.Enqueue(fem)
	got, ok := m.TryMatch(time.Now())
	if !ok || !pair(got, 1, 2) {
		t.Fatalf("cross-bucket range match failed, got ok=%v %d+%d", ok, got.A.UserID, got.B.UserID)
	}
}

// TestSofteningPromotesAcrossBuckets: after softening, a searcher whose peer
// range excluded the only partner's bucket now reaches every opposite bucket.
func TestSofteningPromotesAcrossBuckets(t *testing.T) {
	soften := 30 * time.Second
	m := New(soften)
	base := time.Now()
	a := male(1, Age22_25, Age22_25) // only wants 22-25
	a.EnqueuedAt = base
	b := female(2, Age36, Age22_25) // 36+, out of a's bucket set
	b.EnqueuedAt = base
	_ = m.Enqueue(a)
	_ = m.Enqueue(b)

	if _, ok := m.TryMatch(base.Add(10 * time.Second)); ok {
		t.Fatal("should not match before soften: partner is in an unsearched bucket")
	}
	got, ok := m.TryMatch(base.Add(31 * time.Second))
	if !ok || !pair(got, 1, 2) {
		t.Fatalf("softening should widen buckets and match, got ok=%v %d+%d", ok, got.A.UserID, got.B.UserID)
	}
}

// TestExcludeSkippedWithinBucket: an excluded candidate sitting ahead of a valid
// one in the same target bucket is skipped, not treated as a dead end.
func TestExcludeSkippedWithinBucket(t *testing.T) {
	m := New(0)
	a := male(1, Age22_25)
	a.Exclude = map[int64]bool{2: true}
	// f2 sorts before f3 (older); both live in bucket (female, 22-25).
	f2 := female(2, Age22_25)
	f2.EnqueuedAt = time.Now().Add(-time.Minute)
	f3 := female(3, Age22_25)
	_ = m.Enqueue(a)
	_ = m.Enqueue(f2)
	_ = m.Enqueue(f3)
	got, ok := m.TryMatch(time.Now())
	if !ok || !pair(got, 1, 3) {
		t.Fatalf("excluded f2 should be skipped for f3, got ok=%v %d+%d", ok, got.A.UserID, got.B.UserID)
	}
}

// TestPriorityTieBreakAcrossBuckets: among several eligible partners spread over
// buckets, the highest-Priority one wins; ties fall to older EnqueuedAt.
func TestPriorityTieBreakAcrossBuckets(t *testing.T) {
	m := New(0)
	// Male accepts any age -> searches every female bucket.
	male1 := male(1, Age22_25)
	// Candidates in different age buckets with varied priority/age.
	f18 := female(2, Age18_21)
	f18.Priority = 5
	f18.EnqueuedAt = time.Now().Add(-2 * time.Minute)
	f36 := female(3, Age36)
	f36.Priority = 5
	f36.EnqueuedAt = time.Now().Add(-1 * time.Minute) // same pri, newer -> loses tie
	f26 := female(4, Age26_35)
	f26.Priority = 9 // highest priority -> should win
	_ = m.Enqueue(f18)
	_ = m.Enqueue(f36)
	_ = m.Enqueue(f26)
	_ = m.Enqueue(male1)

	got, ok := m.TryMatch(time.Now())
	if !ok || !pair(got, 1, 4) {
		t.Fatalf("highest-priority female (4) should win across buckets, got ok=%v %d+%d", ok, got.A.UserID, got.B.UserID)
	}
}

// A pair that TryMatch produced is out of the queue, but the caller still has
// to create the topic and persist the row before anything else can see the
// match. Until it Releases them, both must still read as "in the matchmaking
// flow" — the window where they read as neither queued nor matched is what made
// searching clients enqueue a second time and get paired twice.
func TestTryMatchKeepsThePairContainedUntilReleased(t *testing.T) {
	m := New(0)
	_ = m.Enqueue(male(1, Age22_25))
	_ = m.Enqueue(female(2, Age22_25))

	got, ok := m.TryMatch(time.Now())
	if !ok {
		t.Fatal("expected a match")
	}
	if m.Len() != 0 {
		t.Fatalf("matched pair must leave the queue, len=%d", m.Len())
	}
	for _, id := range []int64{got.A.UserID, got.B.UserID} {
		if !m.Contains(id) {
			t.Fatalf("user %d must still read as in-flight before Release", id)
		}
	}
	// And they must not be matchable again while in flight.
	if _, ok := m.TryMatch(time.Now()); ok {
		t.Fatal("an in-flight pair must not be matched a second time")
	}

	m.Release(got.A.UserID, got.B.UserID)
	for _, id := range []int64{got.A.UserID, got.B.UserID} {
		if m.Contains(id) {
			t.Fatalf("user %d should be free after Release", id)
		}
	}
}

// The re-queue path (topic creation failed): Enqueue must supersede the
// in-flight mark, and the Release that onMatch defers must not undo it.
func TestRequeueOfAnInFlightUserSurvivesRelease(t *testing.T) {
	m := New(0)
	_ = m.Enqueue(male(1, Age22_25))
	_ = m.Enqueue(female(2, Age22_25))
	got, _ := m.TryMatch(time.Now())

	if err := m.Enqueue(got.A); err != nil {
		t.Fatalf("re-queueing an in-flight user must work: %v", err)
	}
	m.Release(got.A.UserID, got.B.UserID)

	if !m.Contains(got.A.UserID) || m.Len() != 1 {
		t.Fatalf("re-queued user must still be waiting after Release (len=%d)", m.Len())
	}
	if m.Contains(got.B.UserID) {
		t.Fatal("the un-requeued half must be free")
	}
}

// Leaving mid-pairing is a leave: cancel clears the in-flight mark too, so the
// user is not reported as still searching.
func TestCancelClearsAnInFlightMark(t *testing.T) {
	m := New(0)
	_ = m.Enqueue(male(1, Age22_25))
	_ = m.Enqueue(female(2, Age22_25))
	got, _ := m.TryMatch(time.Now())

	if !m.Cancel(got.A.UserID) {
		t.Fatal("cancel of an in-flight user should report removal")
	}
	if m.Contains(got.A.UserID) {
		t.Fatal("cancelled user must not read as queued")
	}
}

// The stale-waiter sweep must not be able to un-pend a pair mid-pairing: that
// window is what the double-match bug lived in. It also has to still evict
// someone who is genuinely just waiting.
func TestCancelWaitingLeavesAnInFlightPairAlone(t *testing.T) {
	m := New(0)
	_ = m.Enqueue(male(1, Age22_25))
	_ = m.Enqueue(female(2, Age22_25))
	_ = m.Enqueue(male(3, Age22_25)) // no partner left; stays waiting

	pair, ok := m.TryMatch(time.Now())
	if !ok {
		t.Fatal("expected a match")
	}
	if m.CancelWaiting(pair.A.UserID) || m.CancelWaiting(pair.B.UserID) {
		t.Fatal("CancelWaiting removed an in-flight user")
	}
	if !m.Contains(pair.A.UserID) || !m.Contains(pair.B.UserID) {
		t.Fatal("sweep cleared the pending mark — a poll here would read as forgotten")
	}

	if !m.CancelWaiting(3) {
		t.Fatal("CancelWaiting should evict a user who is only waiting")
	}
	if m.Contains(3) || m.Len() != 0 {
		t.Fatalf("user 3 still queued: contains=%v len=%d", m.Contains(3), m.Len())
	}
}
