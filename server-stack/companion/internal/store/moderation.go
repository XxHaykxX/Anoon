package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// CreateReport records a user-submitted complaint against another user. reporter
// and reported are companion user ids; category is one of
// spam|abuse|sexual|illegal|other; topic/details are optional context. It
// returns the new report row id. status defaults to 'open'.
func (s *Store) CreateReport(ctx context.Context, reporterID, reportedID int64, category, topic, details string) (int64, error) {
	var topicVal, detailsVal sql.NullString
	if topic != "" {
		topicVal = sql.NullString{String: topic, Valid: true}
	}
	if details != "" {
		detailsVal = sql.NullString{String: details, Valid: true}
	}
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO reports (reporter_id, reported_id, category, topic, details, status)
		VALUES ($1, $2, $3, $4, $5, 'open')
		RETURNING id`,
		reporterID, reportedID, category, topicVal, detailsVal,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("store: create report: %w", err)
	}
	return id, nil
}

// BanUser suspends a user: it flips users.state to 'susp' (mirrors the Tinode
// account state), records the ban window, writes a row to the bans ledger, and
// appends a moderator_actions entry — all in one transaction. moderatorID is the
// admin operator id (free-form, may be ""). permanent bans carry a NULL
// expiresAt; temporary bans set ban_until so companion can auto-lift on expiry.
// It returns the new ban row id.
func (s *Store) BanUser(ctx context.Context, userID int64, moderatorID, reason string, permanent bool, expiresAt *time.Time) (int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("store: begin ban tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var banUntil sql.NullTime
	if !permanent && expiresAt != nil {
		banUntil = sql.NullTime{Time: *expiresAt, Valid: true}
	}
	mod := nullString(moderatorID)

	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET state = 'susp', ban_until = $2, updated_at = now()
		WHERE id = $1`, userID, banUntil); err != nil {
		return 0, fmt.Errorf("store: ban update user: %w", err)
	}

	var banID int64
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO bans (user_id, moderator_id, reason, permanent, expires_at, status)
		VALUES ($1, $2, $3, $4, $5, 'active')
		RETURNING id`,
		userID, mod, nullString(reason), permanent, banUntil,
	).Scan(&banID); err != nil {
		return 0, fmt.Errorf("store: insert ban: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderator_actions (moderator_id, action_type, target_user_id)
		VALUES ($1, 'ban', $2)`, mod, userID); err != nil {
		return 0, fmt.Errorf("store: ban action log: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("store: commit ban: %w", err)
	}
	return banID, nil
}

// UnbanUser lifts a ban: users.state back to 'ok', ban_until cleared, every
// active bans row for the user marked 'lifted', and a moderator_actions entry
// appended. Idempotent: unbanning a non-banned user is a harmless no-op.
func (s *Store) UnbanUser(ctx context.Context, userID int64, moderatorID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin unban tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	mod := nullString(moderatorID)

	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET state = 'ok', ban_until = NULL, updated_at = now()
		WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("store: unban update user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE bans SET status = 'lifted'
		WHERE user_id = $1 AND status = 'active'`, userID); err != nil {
		return fmt.Errorf("store: unban ledger: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderator_actions (moderator_id, action_type, target_user_id)
		VALUES ($1, 'unban', $2)`, mod, userID); err != nil {
		return fmt.Errorf("store: unban action log: %w", err)
	}
	return tx.Commit()
}

// MuteUser mutes a user until `until`: it sets users.mute_until and appends a
// moderator_actions entry. Mute is companion-enforced (see ModerationStatus and
// the roulette enqueue guard) rather than a hard Tinode ACL change — muting is
// account-wide, whereas dropping the W bit would only cover a single topic.
func (s *Store) MuteUser(ctx context.Context, userID int64, moderatorID string, until time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin mute tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	mod := nullString(moderatorID)
	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET mute_until = $2, updated_at = now()
		WHERE id = $1`, userID, until); err != nil {
		return fmt.Errorf("store: mute update user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderator_actions (moderator_id, action_type, target_user_id)
		VALUES ($1, 'mute', $2)`, mod, userID); err != nil {
		return fmt.Errorf("store: mute action log: %w", err)
	}
	return tx.Commit()
}

// UnmuteUser clears a user's mute (mute_until = NULL) and logs the action.
func (s *Store) UnmuteUser(ctx context.Context, userID int64, moderatorID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin unmute tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	mod := nullString(moderatorID)
	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET mute_until = NULL, updated_at = now()
		WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("store: unmute update user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderator_actions (moderator_id, action_type, target_user_id)
		VALUES ($1, 'unmute', $2)`, mod, userID); err != nil {
		return fmt.Errorf("store: unmute action log: %w", err)
	}
	return tx.Commit()
}

// ModerationStatus reports whether a user is currently banned and/or muted, as
// of now. A user is banned if state='susp' AND (ban_until is NULL/permanent or
// still in the future); muted if mute_until is set and in the future. Used to
// gate actions such as joining the roulette queue.
func (s *Store) ModerationStatus(ctx context.Context, userID int64) (banned, muted bool, err error) {
	var state string
	var banUntil, muteUntil sql.NullTime
	err = s.db.QueryRowContext(ctx, `
		SELECT state, ban_until, mute_until FROM users WHERE id = $1`, userID,
	).Scan(&state, &banUntil, &muteUntil)
	if err != nil {
		return false, false, fmt.Errorf("store: moderation status: %w", err)
	}
	now := time.Now()
	if state == "susp" && (!banUntil.Valid || banUntil.Time.After(now)) {
		banned = true
	}
	if muteUntil.Valid && muteUntil.Time.After(now) {
		muted = true
	}
	return banned, muted, nil
}

// ExpireDueBans auto-lifts every active, temporary ban whose expires_at has
// passed: it flips the ban row to 'expired', restores the user to state='ok'/
// ban_until=NULL (the same effect UnbanUser has on the user row), and appends a
// moderator_actions entry with moderator_id NULL (system-driven, not an
// operator). It returns the companion user ids that were auto-unbanned so the
// caller can also lift their Tinode account state (see tinode.Client.Unban).
//
// Permanent bans (expires_at IS NULL) are never touched here — only the
// companion admin API's explicit lift path clears those.
func (s *Store) ExpireDueBans(ctx context.Context) ([]int64, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("store: begin expire bans tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT user_id FROM bans
		WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
		FOR UPDATE`)
	if err != nil {
		return nil, fmt.Errorf("store: select due bans: %w", err)
	}
	var userIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("store: scan due ban: %w", err)
		}
		userIDs = append(userIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("store: iterate due bans: %w", err)
	}
	rows.Close()

	if len(userIDs) == 0 {
		return nil, tx.Commit()
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE bans SET status = 'expired'
		WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()`); err != nil {
		return nil, fmt.Errorf("store: expire bans: %w", err)
	}

	for _, id := range userIDs {
		if _, err := tx.ExecContext(ctx, `
			UPDATE users SET state = 'ok', ban_until = NULL, updated_at = now()
			WHERE id = $1`, id); err != nil {
			return nil, fmt.Errorf("store: expire ban update user %d: %w", id, err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO moderator_actions (moderator_id, action_type, target_user_id)
			VALUES (NULL, 'unban', $1)`, id); err != nil {
			return nil, fmt.Errorf("store: expire ban action log user %d: %w", id, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("store: commit expire bans: %w", err)
	}
	return userIDs, nil
}

// nullString wraps a possibly-empty string as a NULL-able SQL value.
func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
