// Package matchmaker holds the anoon roulette matching engine: an in-memory
// queue of waiting users and the pure compatibility rules that pair them.
//
// It is deliberately free of any Tinode / DB / HTTP dependency so the matching
// logic can be unit-tested in isolation. The orchestration around it (persisting
// the queue, creating the anon Tinode topic on a match, emitting the WS event)
// lives in the api layer.
//
// Rules (see COMPANION-PLAN.md / BUILD-PLAN.md C2):
//   - Gender is auto-opposite: a male is only ever paired with a female and vice
//     versa. There is no same-gender roulette.
//   - Own age range is required; desired peer age ranges are an optional
//     multi-select. An empty peer selection means "any age".
//   - The match must satisfy BOTH sides' age preference.
//   - Softening: once a user has waited longer than softenAfter, their age
//     filter is dropped (they fall back to gender-only) so the queue keeps
//     draining under thin density.
//   - Paid tiers enqueue with a higher Priority and are matched first.
//
// Data structure: waiting entries are indexed by a bucket key (gender, own age
// range) and kept sorted within each bucket by match-scan order. A searcher only
// looks at the few opposite-gender buckets its age preference allows, instead of
// scanning the whole queue — so finding a partner is ~O(bucket) rather than the
// old O(n) full scan, and there is no per-tick global re-sort.
package matchmaker

import (
	"errors"
	"sort"
	"sync"
	"time"
)

// Age range buckets used by the anoon UI. Own range is one of these; peer ranges
// are a subset. Kept as opaque strings — the engine only compares equality/
// membership, so adding a bucket needs no code change here.
const (
	Age18_21 = "18-21"
	Age22_25 = "22-25"
	Age26_35 = "26-35"
	Age36    = "36+"
)

// ValidAgeRanges is the set the API layer validates enqueue requests against.
var ValidAgeRanges = map[string]bool{
	Age18_21: true, Age22_25: true, Age26_35: true, Age36: true,
}

// BucketForAge maps a self-reported age onto its UI bucket. Used when a peer's
// age range has to be reconstructed outside the queue (the roulette status
// resync reads the stored profile age — the enqueue-time bucket only lives in
// the in-memory Entry). Ages below the platform minimum return "" — the field
// is optional on the wire and the UI simply omits it.
func BucketForAge(age int) string {
	switch {
	case age >= 36:
		return Age36
	case age >= 26:
		return Age26_35
	case age >= 22:
		return Age22_25
	case age >= 18:
		return Age18_21
	default:
		return ""
	}
}

// Gender values (irreversible, chosen at registration).
const (
	Male   = "male"
	Female = "female"
)

// ErrAlreadyQueued is returned by Enqueue when the user is already waiting.
var ErrAlreadyQueued = errors.New("matchmaker: user already in queue")

// Entry is one user waiting in the roulette queue.
type Entry struct {
	UserID        int64  // internal companion user id
	HashID        int64  // public #ID (for the matched event)
	Gender        string // Male | Female
	AgeRange      string // own bucket, required
	PeerAgeRanges []string
	Priority      int       // higher = matched sooner (paid tiers)
	EnqueuedAt    time.Time // for softening + fairness ordering
	// Exclude holds user ids this entry must never be paired with:
	// recently-matched peers (avoid immediate repeats) and blocked users.
	Exclude map[int64]bool

	// seq is a monotonic insertion sequence assigned by Enqueue. It is the
	// stable final tie-break (same role the old insertion-order slice played)
	// so ordering is identical to a full stable sort of the queue.
	seq int64
}

// Match is a produced pairing.
type Match struct {
	A *Entry
	B *Entry
}

// bucketKey indexes waiting entries by their own gender and age range. Both are
// immutable for a queued entry, so softening never moves an entry between
// buckets — it only widens which buckets a *searcher* looks at.
type bucketKey struct {
	gender string
	age    string
}

// Matcher is the concurrent-safe in-memory queue + matching engine.
type Matcher struct {
	mu      sync.Mutex
	entries map[int64]*Entry       // by UserID
	buckets map[bucketKey][]*Entry // (gender, age) -> entries sorted by less
	// pending holds users TryMatch has already taken out of the queue but whose
	// match the rest of the system cannot see yet — the caller still has to
	// create the Tinode topic and persist the row, which takes hundreds of
	// milliseconds of network and database work.
	//
	// Without this, that whole window answers "not queued" AND "no match", a
	// combination that never legitimately happens: a searching client that polls
	// into it concludes the queue forgot about it and enqueues again, so the
	// same two people get paired a second time on a second topic while the first
	// pairing is still being built. That is exactly what happened live —
	// companion logged `matched #00011 <-> #00012` twice within one second and
	// the two sides ended up in different topics, each convinced it was in a
	// chat with the other.
	pending     map[int64]struct{}
	seq         int64 // next insertion sequence
	softenAfter time.Duration
}

// New builds an empty Matcher. softenAfter is how long a user waits before their
// age filter is relaxed to gender-only; pass 0 to disable softening.
func New(softenAfter time.Duration) *Matcher {
	return &Matcher{
		entries:     make(map[int64]*Entry),
		buckets:     make(map[bucketKey][]*Entry),
		pending:     make(map[int64]struct{}),
		softenAfter: softenAfter,
	}
}

// Enqueue adds e to the queue. One entry per user: a second enqueue for a user
// already present returns ErrAlreadyQueued (the caller should cancel first).
func (m *Matcher) Enqueue(e *Entry) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.entries[e.UserID]; ok {
		return ErrAlreadyQueued
	}
	// A fresh entry supersedes an in-flight pairing: this is the re-queue path
	// onMatch takes when the topic could not be created, and the user is now
	// genuinely waiting in line again.
	delete(m.pending, e.UserID)
	e.seq = m.seq
	m.seq++
	m.entries[e.UserID] = e
	m.insertBucketLocked(e)
	return nil
}

// Cancel removes a user from the queue. Returns true if they were present.
// It also drops any in-flight pairing mark: a user who asked to leave is not
// waiting for anything, whatever the matcher was in the middle of doing.
func (m *Matcher) Cancel(userID int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, wasPending := m.pending[userID]
	delete(m.pending, userID)
	return m.removeLocked(userID) || wasPending
}

// CancelWaiting removes a user only if they are WAITING in line, and never
// touches the in-flight pending mark. It returns true when an entry was
// actually taken out.
//
// This is the eviction path for background sweeps — the stale/banned waiter
// prune, which decides who to drop from a database read taken outside the lock.
// By the time it acts, TryMatch may already have pulled that user out for a
// pairing the rest of the system cannot see yet; clearing their pending mark
// there would answer the poll with "neither queued nor matched", the exact
// combination that made a client re-enqueue and get paired twice (see pending).
// A user mid-pairing is not waiting for anything, so there is nothing for a
// sweep to cancel: Cancel stays the honest answer for a user who *asked* to
// leave, this one for a sweep that merely noticed they went quiet.
func (m *Matcher) CancelWaiting(userID int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.pending[userID]; ok {
		return false
	}
	return m.removeLocked(userID)
}

// Release clears the in-flight mark TryMatch set on a pair, once their match is
// observable elsewhere (persisted and announced) or definitively abandoned.
// Callers should defer it right after TryMatch so no early return can strand a
// user as permanently "queued" — see the pending field.
func (m *Matcher) Release(userIDs ...int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range userIDs {
		delete(m.pending, id)
	}
}

// Contains reports whether the user is somewhere in the matchmaking flow —
// waiting in the queue, or taken out of it for a pairing that is still being
// created. Both answers mean the same thing to a caller: do not enqueue them
// again. See the pending field for why the second case must not read as "no".
func (m *Matcher) Contains(userID int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.entries[userID]; ok {
		return true
	}
	_, ok := m.pending[userID]
	return ok
}

// Len is the current queue size.
func (m *Matcher) Len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.entries)
}

// TryMatch finds one compatible pair, removes both from the queue, and returns
// it. When no pair is compatible it returns ok=false. Callers loop it to drain
// multiple matches per tick.
//
// It visits waiting entries in (Priority desc, EnqueuedAt asc, insertion asc)
// order via a lazy k-way merge over the buckets, and returns the first entry
// that has a compatible partner paired with its lowest-ordered such partner.
// This is identical to the old "sort everyone, first compatible (i<j) pair
// wins" nested scan, but the partner lookup only touches the handful of
// opposite-gender buckets the searcher's age preference allows.
func (m *Matcher) TryMatch(now time.Time) (Match, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Cursors into every bucket; each bucket is already sorted by less, so
	// repeatedly taking the global-min head yields exact global scan order.
	lists := make([][]*Entry, 0, len(m.buckets))
	cursors := make([]int, 0, len(m.buckets))
	for _, b := range m.buckets {
		lists = append(lists, b)
		cursors = append(cursors, 0)
	}

	for {
		sel := -1
		for i := range lists {
			if cursors[i] >= len(lists[i]) {
				continue
			}
			if sel == -1 || less(lists[i][cursors[i]], lists[sel][cursors[sel]]) {
				sel = i
			}
		}
		if sel == -1 {
			return Match{}, false // all buckets exhausted, no partner anywhere
		}
		a := lists[sel][cursors[sel]]
		cursors[sel]++

		if b, ok := m.bestPartnerLocked(a, now); ok {
			// We only mutate the buckets once a winner is found and we are
			// about to return, so the cursors above stay valid throughout.
			m.removeLocked(a.UserID)
			m.removeLocked(b.UserID)
			// Out of the queue but not yet in a match anyone can see — hold them
			// in that state until the caller Releases them.
			m.pending[a.UserID] = struct{}{}
			m.pending[b.UserID] = struct{}{}
			return Match{A: a, B: b}, true
		}
	}
}

// bestPartnerLocked returns a's lowest-ordered compatible partner, or ok=false.
// It inspects only the opposite-gender buckets whose age matches a's preference
// (all opposite-gender buckets when a is softened or has no age preference).
// compatible() remains the sole source of truth, so limiting the buckets is a
// pure search-space reduction, not a behaviour change. Caller holds mu.
func (m *Matcher) bestPartnerLocked(a *Entry, now time.Time) (*Entry, bool) {
	target := opposite(a.Gender)
	if target == "" {
		return nil, false
	}

	var best *Entry
	// consider scans one sorted bucket and folds in its first compatible entry.
	// Because the bucket is sorted by less, the first compatible entry is that
	// bucket's lowest-ordered candidate; taking the min across buckets gives a's
	// global lowest-ordered partner.
	consider := func(list []*Entry) {
		for _, cand := range list {
			if compatible(a, cand, m.softenAfter, now) {
				if best == nil || less(cand, best) {
					best = cand
				}
				return
			}
		}
	}

	if searchAllAges(a, m.softenAfter, now) {
		// Any age: every opposite-gender bucket is a candidate. This also
		// covers age strings outside the known set (softened accepts them).
		for k, list := range m.buckets {
			if k.gender == target {
				consider(list)
			}
		}
	} else {
		// Only the specific peer age buckets the searcher asked for.
		for _, age := range a.PeerAgeRanges {
			consider(m.buckets[bucketKey{gender: target, age: age}])
		}
	}

	if best == nil {
		return nil, false
	}
	return best, true
}

// searchAllAges reports whether a's search should span every opposite-gender
// age bucket: true when a has softened past its wait or set no age preference.
func searchAllAges(a *Entry, softenAfter time.Duration, now time.Time) bool {
	return softened(a, softenAfter, now) || len(a.PeerAgeRanges) == 0
}

// insertBucketLocked adds e to its (gender, age) bucket keeping it sorted by
// less. Caller holds mu.
func (m *Matcher) insertBucketLocked(e *Entry) {
	k := bucketKey{gender: e.Gender, age: e.AgeRange}
	b := m.buckets[k]
	i := sort.Search(len(b), func(i int) bool { return less(e, b[i]) })
	b = append(b, nil)
	copy(b[i+1:], b[i:])
	b[i] = e
	m.buckets[k] = b
}

// removeLocked deletes a user from the map and its bucket. Caller holds mu.
func (m *Matcher) removeLocked(userID int64) bool {
	e, ok := m.entries[userID]
	if !ok {
		return false
	}
	delete(m.entries, userID)
	k := bucketKey{gender: e.Gender, age: e.AgeRange}
	b := m.buckets[k]
	for i, x := range b {
		if x.UserID == userID {
			b = append(b[:i], b[i+1:]...)
			break
		}
	}
	if len(b) == 0 {
		delete(m.buckets, k)
	} else {
		m.buckets[k] = b
	}
	return true
}

// less is the total match-scan order: higher Priority first, then older
// EnqueuedAt, then insertion sequence (stable final tie-break). It matches the
// old full stable sort exactly.
func less(a, b *Entry) bool {
	if a.Priority != b.Priority {
		return a.Priority > b.Priority
	}
	if !a.EnqueuedAt.Equal(b.EnqueuedAt) {
		return a.EnqueuedAt.Before(b.EnqueuedAt)
	}
	return a.seq < b.seq
}

// compatible is the pure pairing predicate. It is symmetric in a and b.
func compatible(a, b *Entry, softenAfter time.Duration, now time.Time) bool {
	if a.UserID == b.UserID {
		return false
	}
	if a.Exclude[b.UserID] || b.Exclude[a.UserID] {
		return false
	}
	if a.Gender == "" || b.Gender == "" {
		return false
	}
	// Auto-opposite gender. This single check enforces both directions.
	if b.Gender != opposite(a.Gender) {
		return false
	}
	// Both sides' age preference must be satisfied (or softened away).
	if !ageOK(a, b, softenAfter, now) || !ageOK(b, a, softenAfter, now) {
		return false
	}
	return true
}

// ageOK reports whether want's age filter accepts other. A softened (long-
// waiting) or preference-less entry accepts any age.
func ageOK(want, other *Entry, softenAfter time.Duration, now time.Time) bool {
	if softened(want, softenAfter, now) {
		return true
	}
	if len(want.PeerAgeRanges) == 0 {
		return true
	}
	for _, r := range want.PeerAgeRanges {
		if r == other.AgeRange {
			return true
		}
	}
	return false
}

// softened reports whether the entry has waited past softenAfter.
func softened(e *Entry, softenAfter time.Duration, now time.Time) bool {
	if softenAfter <= 0 {
		return false
	}
	return now.Sub(e.EnqueuedAt) >= softenAfter
}

// opposite returns the auto-selected target gender for g ("" for unknown).
func opposite(g string) string {
	switch g {
	case Male:
		return Female
	case Female:
		return Male
	default:
		return ""
	}
}
