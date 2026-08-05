package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrNoMatch is returned when a topic has no active/known roulette match.
var ErrNoMatch = errors.New("store: match not found")

// Match is an established anonymous pairing behind a Tinode topic.
type Match struct {
	ID       int64
	Topic    string
	UserA    int64 // companion user ids
	UserB    int64
	Status   string // active | ended | revealed
	RevealBy int64  // 0 when nobody has requested reveal
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

// CreateMatch records a new active pairing for the given topic.
func (s *Store) CreateMatch(ctx context.Context, topic string, userA, userB int64) (Match, error) {
	m := Match{Topic: topic, UserA: userA, UserB: userB, Status: "active"}
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO roulette_matches (topic, user_a, user_b)
		VALUES ($1, $2, $3)
		RETURNING id`, topic, userA, userB,
	).Scan(&m.ID)
	if err != nil {
		return Match{}, fmt.Errorf("store: create match: %w", err)
	}
	return m, nil
}

// MatchByTopic loads a match by its Tinode topic. Returns ErrNoMatch if absent.
func (s *Store) MatchByTopic(ctx context.Context, topic string) (Match, error) {
	m := Match{Topic: topic}
	var revealBy sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_a, user_b, status, reveal_by
		FROM roulette_matches WHERE topic = $1`, topic,
	).Scan(&m.ID, &m.UserA, &m.UserB, &m.Status, &revealBy)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrNoMatch
	}
	if err != nil {
		return Match{}, fmt.Errorf("store: match by topic: %w", err)
	}
	m.RevealBy = revealBy.Int64
	return m, nil
}

// ActiveMatchForUser returns the caller's currently-live anon match, or
// ErrNoMatch when they are not in one. It backs the roulette status resync
// (GET /roulette/status): the `matched` WS event is delivered best-effort, so a
// client that misses the frame needs a way to ask "am I already paired?".
// A user can only have one active match at a time (enqueue ends the previous
// one — see EndActiveMatchesForUser), but ORDER BY id DESC makes the query
// deterministic even if a stale row ever lingered.
func (s *Store) ActiveMatchForUser(ctx context.Context, userID int64) (Match, error) {
	var m Match
	var revealBy sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, topic, user_a, user_b, status, reveal_by
		FROM roulette_matches
		WHERE (user_a = $1 OR user_b = $1) AND status = 'active'
		ORDER BY id DESC
		LIMIT 1`, userID,
	).Scan(&m.ID, &m.Topic, &m.UserA, &m.UserB, &m.Status, &revealBy)
	if errors.Is(err, sql.ErrNoRows) {
		return Match{}, ErrNoMatch
	}
	if err != nil {
		return Match{}, fmt.Errorf("store: active match for user: %w", err)
	}
	m.RevealBy = revealBy.Int64
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
	if _, err := s.db.ExecContext(ctx, `
		UPDATE roulette_matches SET reveal_by = $2
		WHERE topic = $1 AND reveal_by IS NULL`, topic, byUser); err != nil {
		return Match{}, fmt.Errorf("store: request reveal: %w", err)
	}
	m.RevealBy = byUser
	return m, nil
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

// AddRating adds one rating (1..5) to a user's running average.
func (s *Store) AddRating(ctx context.Context, userID int64, rating int) error {
	if rating < 1 || rating > 5 {
		return fmt.Errorf("store: rating out of range: %d", rating)
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE users
		SET rating_sum = rating_sum + $2, rating_count = rating_count + 1, updated_at = now()
		WHERE id = $1`, userID, rating)
	if err != nil {
		return fmt.Errorf("store: add rating: %w", err)
	}
	return nil
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
