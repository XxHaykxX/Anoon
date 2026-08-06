package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrNoMatch is returned when a topic has no active/known roulette match.
var ErrNoMatch = errors.New("store: match not found")

// Anonymous per-match aliases (H2). During the anon phase a member is known to
// their peer ONLY by the alias recorded for them on this match — never by the
// real #ID, which is what /me returns and /friends/search resolves.
//
// AliasSigil is deliberately not "#": the UI shows the peer's handle verbatim,
// and "~K7X2QM" cannot be mistaken for (or pasted into a search as) a real
// "#00012". aliasAlphabet drops I/O/0/1 so a user reading one aloud or off a
// screenshot for a moderation report can't garble it. Six characters over a
// 32-symbol alphabet is ~1e9 values; aliases are only ever resolved inside the
// one match that owns them, so this is a legibility choice, not a security one.
const (
	AliasSigil     = "~"
	aliasLen       = 6
	aliasAlphabet  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	aliasAlphabetN = len(aliasAlphabet)
)

// Match is an established anonymous pairing behind a Tinode topic.
type Match struct {
	ID       int64
	Topic    string
	UserA    int64 // companion user ids
	UserB    int64
	Status   string // active | ended | revealed
	RevealBy int64  // 0 when nobody has requested reveal
	// RevealDeclinedBy is who turned the last request down, 0 when none was.
	// Cleared when a fresh request claims the slot. Read it through
	// RevealStateFor rather than directly — what it means depends on which
	// member is asking.
	RevealDeclinedBy int64
	// DeclinesA/DeclinesB count how many times UserA / UserB have had a reveal
	// request of their own turned down in this match. Read through DeclinesFor.
	DeclinesA int
	DeclinesB int
	// AliasA/AliasB are the public "~K7X2QM" handles standing in for UserA /
	// UserB while this match is anonymous. Use AliasFor / PeerAlias rather than
	// reading them directly.
	AliasA string
	AliasB string
}

// maxRevealDeclines is how many refusals a person may collect in one match
// before they may no longer ask again in it. Two: one "no" can be a mistimed
// question, a second is an answer.
const maxRevealDeclines = 2

// ErrRevealAsksExhausted is returned when a user who has already been declined
// maxRevealDeclines times in a match asks again. It is distinct from a generic
// reveal failure so the client can say something honest instead of showing a
// retry that will never work.
var ErrRevealAsksExhausted = errors.New("store: no reveal requests left in this match")

// DeclinesFor returns how many times uid has been turned down in this match.
func (m Match) DeclinesFor(uid int64) int {
	switch uid {
	case m.UserA:
		return m.DeclinesA
	case m.UserB:
		return m.DeclinesB
	default:
		return 0
	}
}

// RevealAsksLeft is how many more times uid may ask in this match. Zero means
// the answer stands. Counted per person: a peer's refusals never spend yours,
// and being refused never stops you ACCEPTING a request they make.
func (m Match) RevealAsksLeft(uid int64) int {
	if !m.Has(uid) {
		return 0
	}
	left := maxRevealDeclines - m.DeclinesFor(uid)
	if left < 0 {
		return 0
	}
	return left
}

// Reveal states, from one member's point of view. These strings go out on
// GET /roulette/status and the client switches on them, so they are a wire
// contract: keep them in step with AnonRevealState in
// frontend/src/types/companion.ts.
const (
	RevealNone          = "none"           // nobody has asked
	RevealWeRequested   = "we_requested"   // we asked, still waiting
	RevealPeerRequested = "peer_requested" // they asked, we have not answered
	RevealDeclined      = "declined"       // we asked and were turned down
	RevealDone          = "revealed"       // mutual, identities exchanged
)

// RevealStateFor renders the reveal exchange from viewerID's side. It exists so
// a client that missed a `reveal_request`, `reveal_declined` or `revealed`
// socket frame can recover the answer by polling — the frames are best-effort,
// and a backgrounded app that misses one would otherwise wait forever on a
// question that has already been answered.
//
// The decline case is asymmetric, which is the whole reason the stored column
// records the DECLINER: their having declined means we were refused, while our
// having declined means the exchange is simply over and we may ask afresh.
func (m Match) RevealStateFor(viewerID int64) string {
	if !m.Has(viewerID) {
		return RevealNone
	}
	if m.Status == "revealed" {
		return RevealDone
	}
	switch {
	case m.RevealBy == viewerID:
		return RevealWeRequested
	case m.RevealBy != 0:
		return RevealPeerRequested
	case m.RevealDeclinedBy != 0 && m.RevealDeclinedBy != viewerID:
		return RevealDeclined
	default:
		return RevealNone
	}
}

// Peer returns the other member's user id given one member. Zero if uid is not
// part of the match.
func (m Match) Peer(uid int64) int64 {
	switch uid {
	case m.UserA:
		return m.UserB
	case m.UserB:
		return m.UserA
	default:
		return 0
	}
}

// Has reports whether uid is one of the two members.
func (m Match) Has(uid int64) bool { return uid == m.UserA || uid == m.UserB }

// AliasFor returns the alias that identifies uid to their peer in this match —
// i.e. what uid looks like from the other side. Empty if uid is not a member.
func (m Match) AliasFor(uid int64) string {
	switch uid {
	case m.UserA:
		return m.AliasA
	case m.UserB:
		return m.AliasB
	default:
		return ""
	}
}

// PeerAlias returns the alias of uid's peer — what uid should be shown in place
// of the peer's real #ID. Empty if uid is not a member.
func (m Match) PeerAlias(uid int64) string { return m.AliasFor(m.Peer(uid)) }

// Anon reports whether the match is still in its anonymous phase, i.e. neither
// side has learned the other's real identity. A revealed match is a friend chat
// and identities flow normally from then on.
func (m Match) Anon() bool { return m.Status != "revealed" }

// newAnonAlias mints one random public alias ("~K7X2QM"). It reads from
// crypto/rand because a guessable alias would let a peer correlate matches.
func newAnonAlias() (string, error) {
	buf := make([]byte, aliasLen)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("store: alias entropy: %w", err)
	}
	var sb strings.Builder
	sb.WriteString(AliasSigil)
	for _, b := range buf {
		// aliasAlphabetN is 32 and divides 256, so the modulo is unbiased.
		sb.WriteByte(aliasAlphabet[int(b)%aliasAlphabetN])
	}
	return sb.String(), nil
}

// NormalizeAlias trims a client-supplied alias to the exact stored form, or
// returns "" if it is not shaped like one. The sigil is required: it is what
// keeps an alias from ever being confused with a bare "#ID" spelling on a wire
// field that accepts both (see api.resolveRelayTarget). Callers must still check
// that the alias belongs to a match the caller is in — an alias is meaningless
// (and unresolvable) outside its own match.
func NormalizeAlias(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if !strings.HasPrefix(s, AliasSigil) {
		return ""
	}
	s = strings.TrimPrefix(s, AliasSigil)
	if len(s) != aliasLen {
		return ""
	}
	for _, r := range s {
		if !strings.ContainsRune(aliasAlphabet, r) {
			return ""
		}
	}
	return AliasSigil + s
}

// CreateMatch records a new active pairing for the given topic, minting the two
// per-match anon aliases (H2) that stand in for the members' real #IDs until a
// mutual reveal.
func (s *Store) CreateMatch(ctx context.Context, topic string, userA, userB int64) (Match, error) {
	aliasA, err := newAnonAlias()
	if err != nil {
		return Match{}, err
	}
	aliasB, err := newAnonAlias()
	if err != nil {
		return Match{}, err
	}
	// Two identical aliases in one match would make the pair indistinguishable
	// in moderation records; one retry is plenty at 1-in-a-billion odds.
	if aliasB == aliasA {
		if aliasB, err = newAnonAlias(); err != nil {
			return Match{}, err
		}
	}

	m := Match{Topic: topic, UserA: userA, UserB: userB, Status: "active", AliasA: aliasA, AliasB: aliasB}
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO roulette_matches (topic, user_a, user_b, alias_a, alias_b)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`, topic, userA, userB, aliasA, aliasB,
	).Scan(&m.ID)
	if err != nil {
		return Match{}, fmt.Errorf("store: create match: %w", err)
	}
	return m, nil
}

// MatchByTopic loads a match by its Tinode topic. Returns ErrNoMatch if absent.
func (s *Store) MatchByTopic(ctx context.Context, topic string) (Match, error) {
	m := Match{Topic: topic}
	var revealBy, declinedBy sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_a, user_b, status, reveal_by, reveal_declined_by, reveal_declines_a, reveal_declines_b, alias_a, alias_b
		FROM roulette_matches WHERE topic = $1`, topic,
	).Scan(&m.ID, &m.UserA, &m.UserB, &m.Status, &revealBy, &declinedBy, &m.DeclinesA, &m.DeclinesB, &m.AliasA, &m.AliasB)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrNoMatch
	}
	if err != nil {
		return Match{}, fmt.Errorf("store: match by topic: %w", err)
	}
	m.RevealBy = revealBy.Int64
	m.RevealDeclinedBy = declinedBy.Int64
	return m, nil
}

// MatchByPeerAlias resolves an alias the caller was shown back to the match it
// belongs to. It is scoped to matches viewerID is a member of and to the alias
// of the OTHER member, so an alias is only ever resolvable by the one person it
// was minted for — knowing (or guessing) someone else's alias buys nothing.
//
// This is what lets the anon phase keep working without the real #ID: call
// signaling addresses the peer by the alias the client already holds, and the
// server maps it back to a user id itself. Returns ErrNoMatch when the alias is
// malformed or does not name one of the caller's peers.
//
// Ended matches still resolve, deliberately: a call outlives the chat (the call
// overlay is mounted app-wide, not by the chat screen), so a hangup or a late
// ICE candidate must still reach the other side after either party left. That
// leaves an alias usable for as long as the row exists — but no more so than the
// real #ID the client used to be handed here, and reaching a stranger's socket
// still requires them to be online.
func (s *Store) MatchByPeerAlias(ctx context.Context, viewerID int64, alias string) (Match, error) {
	alias = NormalizeAlias(alias)
	if alias == "" {
		return Match{}, ErrNoMatch
	}
	var m Match
	var revealBy, declinedBy sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, topic, user_a, user_b, status, reveal_by, reveal_declined_by, reveal_declines_a, reveal_declines_b, alias_a, alias_b
		FROM roulette_matches
		WHERE ((user_a = $1 AND alias_b = $2) OR (user_b = $1 AND alias_a = $2))
		ORDER BY id DESC
		LIMIT 1`, viewerID, alias,
	).Scan(&m.ID, &m.Topic, &m.UserA, &m.UserB, &m.Status, &revealBy, &declinedBy, &m.DeclinesA, &m.DeclinesB, &m.AliasA, &m.AliasB)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrNoMatch
	}
	if err != nil {
		return Match{}, fmt.Errorf("store: match by peer alias: %w", err)
	}
	m.RevealBy = revealBy.Int64
	m.RevealDeclinedBy = declinedBy.Int64
	return m, nil
}

// LiveMatchBetween returns the most recent still-running match between two
// users, or ErrNoMatch. "Still running" is active OR revealed: a revealed pair
// keeps talking on the same grp topic, so the pairing is no less current for
// having dropped its anonymity.
//
// It exists for the #ID branch of resolveRelayTarget, whose fallback used
// the status='active' lookup and so silently missed exactly the case it was
// written for. The reveal path marks the pair friends best-effort — MarkFriends
// failing is logged, not fatal — and the fallback is what keeps a just-revealed
// pair's calls working when that write lost. But AcceptReveal has by then set
// status='revealed', which a `status = 'active'` filter
// excludes, so the safety net could never have caught anything.
func (s *Store) LiveMatchBetween(ctx context.Context, a, b int64) (Match, error) {
	if a == 0 || b == 0 || a == b {
		return Match{}, ErrNoMatch
	}
	var m Match
	var revealBy, declinedBy sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, topic, user_a, user_b, status, reveal_by, reveal_declined_by, reveal_declines_a, reveal_declines_b, alias_a, alias_b
		FROM roulette_matches
		WHERE status <> 'ended'
		  AND ((user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1))
		ORDER BY id DESC
		LIMIT 1`, a, b,
	).Scan(&m.ID, &m.Topic, &m.UserA, &m.UserB, &m.Status, &revealBy, &declinedBy, &m.DeclinesA, &m.DeclinesB, &m.AliasA, &m.AliasB)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrNoMatch
	}
	if err != nil {
		return Match{}, fmt.Errorf("store: live match between %d and %d: %w", a, b, err)
	}
	m.RevealBy = revealBy.Int64
	m.RevealDeclinedBy = declinedBy.Int64
	return m, nil
}

// CurrentMatchForUser returns the chat the caller is in right now, or
// ErrNoMatch. It backs the roulette status resync (GET /roulette/status): every
// event that moves a pairing forward — `matched`, `reveal_request`,
// `reveal_declined`, `revealed` — is delivered best-effort, so a client that
// missed one needs a way to ask where things stand.
//
// "Current" is active OR revealed, not just active. It was `status = 'active'`
// while it only had to answer "am I already paired?", but a revealed pair is
// still in that chat, and excluding them made the `revealed` reveal-state
// literally unreachable through this endpoint: the row was filtered out, so the
// handler reported no match at all and never got as far as describing the
// reveal. A client that missed the `revealed` frame therefore could not heal
// from the poll — the one case the resync is least able to reconstruct on its
// own, since identity arrives only in that frame.
//
// Ended matches stay excluded: that chat is over and there is nothing to resync.
//
// A user can only have one live match at a time (enqueue ends the previous one
// — see EndActiveMatchesForUser), but ORDER BY id DESC makes the query
// deterministic even if a stale row ever lingered.
//
// KNOWN LIMITATION, and the client MUST allow for it. Nothing ever ends a
// revealed match: EndMatch and EndActiveMatchesForUser both filter
// `status = 'active'`, and leaving a revealed chat writes nothing at all — the
// pair simply keep using that grp topic as friends. So a revealed row stays
// non-ended for good, and this lookup will keep returning it as the caller's
// "current" match long after they walked away, until a newer match outranks it
// by id.
//
// The server cannot tell "just revealed, still in the chat" (the narrow window
// this heals) from "revealed months ago, moved on" — there is no revealed_at,
// and no signal is written when someone leaves. Hence the payload says which it
// is: a consumer must branch on reveal == "revealed" rather than treating a
// non-nil match as "I am in an anonymous chat". Not doing so re-anonymises an
// already-revealed peer and hijacks whatever the user is doing now — which is a
// real bug that was caught in review, not a hypothetical.
//
// Fixing it properly means recording when a member leaves a revealed chat.
// Ending the row instead is NOT the fix: Match.Anon() keys off status, so an
// ended-but-revealed match would start naming two friends by their anon aliases
// again in every relay.
func (s *Store) CurrentMatchForUser(ctx context.Context, userID int64) (Match, error) {
	var m Match
	var revealBy, declinedBy sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, topic, user_a, user_b, status, reveal_by, reveal_declined_by, reveal_declines_a, reveal_declines_b, alias_a, alias_b
		FROM roulette_matches
		WHERE (user_a = $1 OR user_b = $1) AND status <> 'ended'
		ORDER BY id DESC
		LIMIT 1`, userID,
	).Scan(&m.ID, &m.Topic, &m.UserA, &m.UserB, &m.Status, &revealBy, &declinedBy, &m.DeclinesA, &m.DeclinesB, &m.AliasA, &m.AliasB)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrNoMatch
	}
	if err != nil {
		return Match{}, fmt.Errorf("store: current match for user: %w", err)
	}
	m.RevealBy = revealBy.Int64
	m.RevealDeclinedBy = declinedBy.Int64
	return m, nil
}

// EndMatch marks an active match ended (idempotent: ending an ended/revealed
// match is a no-op that still succeeds).
func (s *Store) EndMatch(ctx context.Context, topic string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE roulette_matches
		SET status = 'ended', ended_at = now()
		WHERE topic = $1 AND status = 'active'`, topic)
	if err != nil {
		return fmt.Errorf("store: end match: %w", err)
	}
	return nil
}

// EndActiveMatchesForUser marks every active match involving userID as ended.
// Called when the user (re-)enqueues into roulette: entering the queue again
// means they have necessarily left any previous anon chat, even if they never
// called POST /roulette/end (e.g. they just closed the app/tab). Without this
// cleanup, an abandoned chat stays 'active' forever and permanently occupies
// RecentPartnerIDs's exclude-set lookback for both members.
func (s *Store) EndActiveMatchesForUser(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE roulette_matches
		SET status = 'ended', ended_at = now()
		WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, userID)
	if err != nil {
		return fmt.Errorf("store: end active matches for user: %w", err)
	}
	return nil
}

// RequestReveal records that byUser asked to reveal on topic. It returns the
// peer's user id. Setting reveal_by is idempotent for the same requester.
func (s *Store) RequestReveal(ctx context.Context, topic string, byUser int64) (Match, error) {
	m, err := s.MatchByTopic(ctx, topic)
	if err != nil {
		return Match{}, err
	}
	if !m.Has(byUser) {
		return Match{}, ErrNoMatch
	}
	if m.Status != "active" {
		return Match{}, fmt.Errorf("store: cannot reveal a %s match", m.Status)
	}
	// Two refusals is the answer. Checked per person, so the caller's own
	// history is what stops them — a peer who has been declined twice does not
	// spend the caller's asks, and this never blocks ACCEPTING a request.
	if m.RevealAsksLeft(byUser) == 0 {
		return Match{}, ErrRevealAsksExhausted
	}
	// Claiming the slot also clears any previous refusal: a decline is not
	// final, and a fresh ask supersedes the old answer rather than leaving the
	// requester's own status poll reporting "declined" over their new request.
	res, err := s.db.ExecContext(ctx, `
		UPDATE roulette_matches SET reveal_by = $2, reveal_declined_by = NULL
		WHERE topic = $1 AND reveal_by IS NULL`, topic, byUser)
	if err != nil {
		return Match{}, fmt.Errorf("store: request reveal: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// A request was already pending, so the row is unchanged. Report the
		// state that is actually stored rather than asserting the caller owns
		// it: claiming reveal_by = byUser here was a lie whenever the PEER had
		// asked first, and AcceptReveal reads this field to decide who may
		// accept. m.RevealBy already carries the stored value.
		return m, nil
	}
	m.RevealBy = byUser
	return m, nil
}

// DeclineReveal turns down the reveal request pending on topic and clears it,
// returning the id of the user whose request was declined (0 when there was
// nothing to decline). byUser must be a member of the match, and must not be
// the requester — you cannot decline your own request.
//
// Clearing reveal_by is what makes a decline non-final, which is the product
// rule: either side may ask again afterwards. Leaving the field set (what the
// handler used to do by not touching the store at all) did not merely fail to
// notify anyone — it wedged the pairing. RequestReveal only writes
// `WHERE reveal_by IS NULL`, so with a stale requester still recorded the
// declining user's own later request silently no-opped, and the original
// requester could then never accept it: AcceptReveal refuses an accept from
// whoever reveal_by names. The only route left to a reveal was the person who
// had already been turned down asking a second time.
//
// Idempotent: declining when nothing is pending returns (0, nil) rather than an
// error, so a double-fired request (React StrictMode, a retry) is harmless.
func (s *Store) DeclineReveal(ctx context.Context, topic string, byUser int64) (int64, error) {
	m, err := s.MatchByTopic(ctx, topic)
	if err != nil {
		return 0, err
	}
	if !m.Has(byUser) {
		return 0, ErrNoMatch // not your chat: nothing to decline (anti-spoof)
	}
	if m.RevealBy == 0 || m.RevealBy == byUser {
		return 0, nil // nothing pending, or it is the caller's own request
	}

	requester := m.RevealBy
	// reveal_declined_by records the DECLINER, so GET /roulette/status can tell
	// each side its own story: the requester learns they were turned down even
	// if they missed the socket frame, while the decliner sees nothing pending.
	// The refusal is also spent against the REQUESTER's allowance, never the
	// decliner's — saying no must not cost you your own right to ask later. The
	// CASE picks their side of the row, so which counter moves is decided by the
	// database from the ids it already holds.
	if _, err := s.db.ExecContext(ctx, `
		UPDATE roulette_matches SET
			reveal_by = NULL,
			reveal_declined_by = $3,
			reveal_declines_a = reveal_declines_a + CASE WHEN user_a = $2 THEN 1 ELSE 0 END,
			reveal_declines_b = reveal_declines_b + CASE WHEN user_b = $2 THEN 1 ELSE 0 END
		WHERE topic = $1 AND status = 'active' AND reveal_by = $2`,
		topic, requester, byUser); err != nil {
		return 0, fmt.Errorf("store: decline reveal: %w", err)
	}
	return requester, nil
}

// AcceptReveal completes a mutual reveal: it requires a prior request from the
// OTHER member and flips the match to 'revealed'. It returns the updated match.
// Returns an error if there is no pending request or the accepter is the same
// user who requested.
func (s *Store) AcceptReveal(ctx context.Context, topic string, byUser int64) (Match, error) {
	m, err := s.MatchByTopic(ctx, topic)
	if err != nil {
		return Match{}, err
	}
	if !m.Has(byUser) {
		return Match{}, ErrNoMatch
	}
	if m.RevealBy == 0 || m.RevealBy == byUser {
		return Match{}, errors.New("store: no pending reveal request from the peer")
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE roulette_matches SET status = 'revealed'
		WHERE topic = $1 AND status = 'active' AND reveal_by IS NOT NULL AND reveal_by <> $2`,
		topic, byUser)
	if err != nil {
		return Match{}, fmt.Errorf("store: accept reveal: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Match{}, errors.New("store: reveal could not be completed")
	}
	m.Status = "revealed"
	return m, nil
}

// ActiveMatchTopics returns the topics of all currently-active anon matches.
// Used at startup to re-subscribe the ROOT bot to chats that were live before a
// companion restart, so their {data} resumes flowing for message-push (#112).
// Bounded by the number of concurrent live anon chats; revealed/ended matches
// are excluded (revealed friend chats become permanent and are out of the
// ROOT-observes-{data} model's scope — see internal/api/message_push.go).
func (s *Store) ActiveMatchTopics(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT topic FROM roulette_matches WHERE status = 'active'`)
	if err != nil {
		return nil, fmt.Errorf("store: active match topics: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("store: scan active topic: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// RecentPartnerIDs returns the set of user ids that userID was matched with
// since `since` — used to seed the matcher's Exclude set (avoid instant
// re-pairing with the same person).
func (s *Store) RecentPartnerIDs(ctx context.Context, userID int64, since time.Time) (map[int64]bool, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END
		FROM roulette_matches
		WHERE (user_a = $1 OR user_b = $1) AND created_at >= $2`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("store: recent partners: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]bool)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("store: scan recent partner: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// RateMatch records raterID's 1..5 rating of ratedID for one match and refreshes
// the rated user's running totals from the ledger.
//
// It replaces AddRating, which incremented users.rating_sum/rating_count in
// place. Membership was checked by the caller, correctly, but the action was an
// unbounded increment: any past peer could replay POST /roulette/rate in a loop
// and drive a victim's average wherever they liked, on a match that ended weeks
// ago (S3). A rating is now a fact about a (match, rater) pair — the primary key
// on roulette_ratings makes a replay overwrite its own row — and the totals are
// RECOMPUTED from that table rather than added to, so they cannot drift no
// matter how the endpoint is called.
//
// Re-rating the same match is allowed and simply revises the score: the user has
// one vote per peer, and letting them change their mind costs nothing now that
// it cannot accumulate.
func (s *Store) RateMatch(ctx context.Context, matchID, raterID, ratedID int64, rating int) error {
	if rating < 1 || rating > 5 {
		return fmt.Errorf("store: rating out of range: %d", rating)
	}
	if raterID == ratedID || raterID == 0 || ratedID == 0 {
		return fmt.Errorf("store: rate match: bad rater/rated pair %d/%d", raterID, ratedID)
	}

	// Both statements must land together, or the totals stop matching the ledger.
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: rate match: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO roulette_ratings (match_id, rater_id, rated_id, rating)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (match_id, rater_id)
		DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()`,
		matchID, raterID, ratedID, rating); err != nil {
		return fmt.Errorf("store: rate match: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET
			rating_sum   = (SELECT COALESCE(sum(rating), 0) FROM roulette_ratings WHERE rated_id = $1),
			rating_count = (SELECT count(*)                 FROM roulette_ratings WHERE rated_id = $1),
			updated_at   = now()
		WHERE id = $1`, ratedID); err != nil {
		return fmt.Errorf("store: rate match totals: %w", err)
	}
	return tx.Commit()
}

// Priority values by subscription tier: higher is matched sooner (see
// matchmaker.less). Free (or no subscriptions row at all) is 0 so behavior for
// free users is unchanged whether or not any paid user is in the queue.
const (
	priorityFree         = 0
	priorityPremium      = 1
	prioritySuperPremium = 2
)

// Priority returns the matcher priority for a user based on their current
// subscription tier (subscriptions.tier): premium/super_premium waiters are
// matched sooner within a compatible bucket (see matchmaker.less). A user with
// no subscriptions row, an unrecognized tier, or a lapsed (expires_at in the
// past) paid tier gets priorityFree — identical to today's free-only behavior.
func (s *Store) Priority(ctx context.Context, userID int64) (int, error) {
	var tier string
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT tier, expires_at FROM subscriptions WHERE user_id = $1`, userID,
	).Scan(&tier, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return priorityFree, nil
	}
	if err != nil {
		return 0, fmt.Errorf("store: priority: %w", err)
	}
	if expiresAt.Valid && expiresAt.Time.Before(time.Now()) {
		return priorityFree, nil // paid tier lapsed
	}
	switch tier {
	case "super_premium":
		return prioritySuperPremium, nil
	case "premium":
		return priorityPremium, nil
	default:
		return priorityFree, nil
	}
}
