package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrNoRequest is returned when responding to a friend request that isn't there.
var ErrNoRequest = errors.New("store: friend request not found")

// Friend is one entry in a user's friends list.
type Friend struct {
	UserID    int64  // the friend's companion user id
	HashID    int64  // the friend's #ID
	TinodeUID string // for opening the p2p chat
	Status    string // 'pending' | 'accepted' | 'blocked'
}

// CreateFriendRequest records a directed pending request from -> to. source is
// 'search' | 'invite' | 'reveal'. Re-requesting is idempotent (ON CONFLICT).
func (s *Store) CreateFriendRequest(ctx context.Context, from, to int64, source string) error {
	if from == to {
		return errors.New("store: cannot friend yourself")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO friendships (user_id, friend_id, status, source)
		VALUES ($1, $2, 'pending', $3)
		ON CONFLICT (user_id, friend_id) DO NOTHING`, from, to, source)
	if err != nil {
		return fmt.Errorf("store: create friend request: %w", err)
	}
	return nil
}

// RespondFriendRequest accepts or rejects a pending request that `from` sent to
// `me`. On accept both directions become 'accepted'. On reject the request row
// is removed. Returns the requester's tinode uid (needed to open the p2p chat).
func (s *Store) RespondFriendRequest(ctx context.Context, me, from int64, accept bool) (string, error) {
	// Verify a pending request from `from` to `me` exists.
	var reqID int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id FROM friendships
		WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`, from, me,
	).Scan(&reqID)
	if errors.Is(err, sql.ErrNoRows) {
		// Idempotent accept: a double-fire (React StrictMode / retry) finds the
		// row already 'accepted'. Don't 409 — return the requester's uid so the
		// caller can still open the chat (BUG-42). Only a genuinely missing
		// relationship is ErrNoRequest.
		if accept {
			var st string
			if e2 := s.db.QueryRowContext(ctx,
				`SELECT status FROM friendships WHERE user_id = $1 AND friend_id = $2`, from, me,
			).Scan(&st); e2 == nil && st == "accepted" {
				var uid sql.NullString
				_ = s.db.QueryRowContext(ctx,
					`SELECT tinode_uid FROM users WHERE id = $1`, from).Scan(&uid)
				return uid.String, nil
			}
		}
		return "", ErrNoRequest
	}
	if err != nil {
		return "", fmt.Errorf("store: lookup friend request: %w", err)
	}

	if !accept {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM friendships WHERE id = $1`, reqID); err != nil {
			return "", fmt.Errorf("store: reject friend request: %w", err)
		}
		return "", nil
	}

	if err := s.markAcceptedBoth(ctx, from, me, "search"); err != nil {
		return "", err
	}
	var uid sql.NullString
	if err := s.db.QueryRowContext(ctx,
		`SELECT tinode_uid FROM users WHERE id = $1`, from).Scan(&uid); err != nil {
		return "", fmt.Errorf("store: requester uid: %w", err)
	}
	return uid.String, nil
}

// MarkFriends makes a and b accepted friends in both directions (used by the
// reveal flow, where consent is already mutual). source is recorded on new rows.
func (s *Store) MarkFriends(ctx context.Context, a, b int64, source string) error {
	return s.markAcceptedBoth(ctx, a, b, source)
}

// markAcceptedBoth upserts accepted rows a->b and b->a in one transaction.
func (s *Store) markAcceptedBoth(ctx context.Context, a, b int64, source string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin friends tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	const q = `
		INSERT INTO friendships (user_id, friend_id, status, source)
		VALUES ($1, $2, 'accepted', $3)
		ON CONFLICT (user_id, friend_id)
		DO UPDATE SET status = 'accepted', updated_at = now()`
	if _, err := tx.ExecContext(ctx, q, a, b, source); err != nil {
		return fmt.Errorf("store: accept a->b: %w", err)
	}
	if _, err := tx.ExecContext(ctx, q, b, a, source); err != nil {
		return fmt.Errorf("store: accept b->a: %w", err)
	}
	return tx.Commit()
}

// BlockUser records that blocker has blocked blocked: it upserts the directed
// friendships row blocker->blocked with status='blocked'. Idempotent — an
// existing row (pending/accepted/blocked) is flipped to 'blocked'. The reverse
// direction is left untouched; matchmaking treats a block as symmetric anyway
// (see BlockedUserIDs).
func (s *Store) BlockUser(ctx context.Context, blocker, blocked int64) error {
	if blocker == blocked {
		return errors.New("store: cannot block yourself")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO friendships (user_id, friend_id, status, source)
		VALUES ($1, $2, 'blocked', 'block')
		ON CONFLICT (user_id, friend_id)
		DO UPDATE SET status = 'blocked', updated_at = now()`, blocker, blocked)
	if err != nil {
		return fmt.Errorf("store: block user: %w", err)
	}
	return nil
}

// UnblockUser removes a directed block (blocker -> blocked), taking the pair off
// the caller's blacklist. Idempotent: unblocking someone not on the list is a
// harmless no-op. Only the caller's own directed row is deleted — if the other
// party independently blocked the caller, that row (and the symmetric
// matchmaking exclusion it creates) stays in force.
func (s *Store) UnblockUser(ctx context.Context, blocker, blocked int64) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM friendships
		WHERE user_id = $1 AND friend_id = $2 AND status = 'blocked'`, blocker, blocked)
	if err != nil {
		return fmt.Errorf("store: unblock user: %w", err)
	}
	return nil
}

// BlockedUser is one entry on a user's blacklist (GET /friends/blocks): the
// blocked party's #ID and when the block was recorded.
type BlockedUser struct {
	UserID    int64
	HashID    int64
	BlockedAt time.Time
}

// BlockedList returns everyone the caller has blocked (the directed
// blocker->blocked 'blocked' rows), newest first. This is the Settings
// blacklist — it lists only who the caller blocked, not who blocked them.
func (s *Store) BlockedList(ctx context.Context, blocker int64) ([]BlockedUser, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.hash_id, f.updated_at
		FROM friendships f
		JOIN users u ON u.id = f.friend_id
		WHERE f.user_id = $1 AND f.status = 'blocked'
		ORDER BY f.updated_at DESC`, blocker)
	if err != nil {
		return nil, fmt.Errorf("store: blocked list: %w", err)
	}
	defer rows.Close()

	out := make([]BlockedUser, 0)
	for rows.Next() {
		var b BlockedUser
		if err := rows.Scan(&b.UserID, &b.HashID, &b.BlockedAt); err != nil {
			return nil, fmt.Errorf("store: scan blocked user: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// BlockedUserIDs returns the set of user ids the roulette must never pair with
// userID: everyone userID has blocked, plus everyone who has blocked userID. The
// block is thus symmetric — neither party can be re-matched to the other.
func (s *Store) BlockedUserIDs(ctx context.Context, userID int64) (map[int64]bool, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT friend_id FROM friendships WHERE user_id = $1 AND status = 'blocked'
		UNION
		SELECT user_id FROM friendships WHERE friend_id = $1 AND status = 'blocked'`, userID)
	if err != nil {
		return nil, fmt.Errorf("store: blocked user ids: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]bool)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("store: scan blocked id: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// AreFriends reports whether a and b have an accepted friendship. Used as the
// membership check for relays addressed by a Tinode p2p topic (msg:del,
// activity): p2p topics aren't tracked in roulette_matches, so the friendship
// row is what proves the sender is actually in that conversation and isn't
// spoofing a topic they have no part in. Direction-agnostic — markAcceptedBoth
// writes both rows, but a one-sided row is still enough to be in the chat.
func (s *Store) AreFriends(ctx context.Context, a, b int64) (bool, error) {
	if a == 0 || b == 0 || a == b {
		return false, nil
	}
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT 1 FROM friendships
		WHERE status = 'accepted'
		  AND ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
		LIMIT 1`, a, b,
	).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("store: are friends %d/%d: %w", a, b, err)
	}
	return true, nil
}

// Friends lists a user's accepted friends.
func (s *Store) Friends(ctx context.Context, userID int64) ([]Friend, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.hash_id, u.tinode_uid, f.status
		FROM friendships f
		JOIN users u ON u.id = f.friend_id
		WHERE f.user_id = $1 AND f.status = 'accepted'
		ORDER BY f.updated_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("store: friends list: %w", err)
	}
	defer rows.Close()

	var out []Friend
	for rows.Next() {
		var f Friend
		var uid sql.NullString
		if err := rows.Scan(&f.UserID, &f.HashID, &uid, &f.Status); err != nil {
			return nil, fmt.Errorf("store: scan friend: %w", err)
		}
		f.TinodeUID = uid.String
		out = append(out, f)
	}
	return out, rows.Err()
}

// PendingFriendRequests lists incoming pending requests (others -> me).
func (s *Store) PendingFriendRequests(ctx context.Context, me int64) ([]Friend, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.hash_id, u.tinode_uid, f.status
		FROM friendships f
		JOIN users u ON u.id = f.user_id
		WHERE f.friend_id = $1 AND f.status = 'pending'
		ORDER BY f.created_at DESC`, me)
	if err != nil {
		return nil, fmt.Errorf("store: pending requests: %w", err)
	}
	defer rows.Close()

	var out []Friend
	for rows.Next() {
		var f Friend
		var uid sql.NullString
		if err := rows.Scan(&f.UserID, &f.HashID, &uid, &f.Status); err != nil {
			return nil, fmt.Errorf("store: scan pending: %w", err)
		}
		f.TinodeUID = uid.String
		out = append(out, f)
	}
	return out, rows.Err()
}
