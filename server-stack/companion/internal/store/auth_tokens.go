package store

// auth_tokens.go backs the password-reset + email-verification flows (#116):
// the single-use token ledger (auth_tokens) plus the users.email / login /
// email_verified columns added in migration 0009. Token generation + the email
// send live in the api/mail layers; this file is only persistence.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrTokenInvalid is returned by ConsumeAuthToken when the token does not exist,
// has already been used, or has expired. It is intentionally undifferentiated so
// callers cannot distinguish the cases (no oracle for token guessing).
var ErrTokenInvalid = errors.New("store: auth token invalid, used, or expired")

// SetBasicCredentials records the basic-scheme login (and optional email) for a
// user, so a later password reset can re-issue the Tinode secret and a
// forgot-password lookup can match on email. Called right after CreateUser on
// the basic registration path. email "" leaves the column unchanged/NULL.
func (s *Store) SetBasicCredentials(ctx context.Context, userID int64, login, email string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE users
		SET login = $2, email = COALESCE(NULLIF($3, ''), email), updated_at = now()
		WHERE id = $1`, userID, nullStr(login), email)
	if err != nil {
		return fmt.Errorf("store: set basic credentials: %w", err)
	}
	return nil
}

// UserByEmail resolves a user from an email address for the forgot-password
// flow. It matches (case-insensitively) a basic account's users.email or
// users.login (basic logins are often the email itself), or a linked Google
// identity's oauth_identities.email. Soft-deleted accounts are excluded. found
// is false when nothing matches — callers must still return a generic success
// so account existence is never leaked.
func (s *Store) UserByEmail(ctx context.Context, email string) (User, bool, error) {
	if email == "" {
		return User{}, false, nil
	}
	u := User{}
	var uid sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.tinode_uid, u.hash_id, u.gender, u.age, u.state
		FROM users u
		LEFT JOIN oauth_identities oi ON oi.user_id = u.id
		WHERE u.deleted_at IS NULL
		  AND (lower(u.email) = lower($1)
		    OR lower(u.login) = lower($1)
		    OR lower(oi.email) = lower($1))
		LIMIT 1`, email,
	).Scan(&u.ID, &uid, &u.HashID, &u.Gender, &u.Age, &u.State)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, fmt.Errorf("store: user by email: %w", err)
	}
	u.TinodeUID = uid.String
	return u, true, nil
}

// BasicLogin returns the stored basic-scheme login for a user (for re-issuing
// the Tinode secret on password reset). ok is false when the account has no
// stored login — a Google account, or one registered before migration 0009.
func (s *Store) BasicLogin(ctx context.Context, userID int64) (string, bool, error) {
	var login sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT login FROM users WHERE id = $1`, userID).Scan(&login)
	if err != nil {
		return "", false, fmt.Errorf("store: basic login: %w", err)
	}
	if !login.Valid || login.String == "" {
		return "", false, nil
	}
	return login.String, true, nil
}

// EmailForUser returns the best contact email for a user: users.email if set,
// else a linked Google identity's email. ok is false when neither exists.
func (s *Store) EmailForUser(ctx context.Context, userID int64) (string, bool, error) {
	var email sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(u.email, ''), oi.email)
		FROM users u
		LEFT JOIN oauth_identities oi ON oi.user_id = u.id
		WHERE u.id = $1
		LIMIT 1`, userID).Scan(&email)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("store: email for user: %w", err)
	}
	if !email.Valid || email.String == "" {
		return "", false, nil
	}
	return email.String, true, nil
}

// CreateAuthToken stores a single-use token for purpose ('reset'|'verify')
// belonging to userID, expiring at expiresAt. email is the address it was mailed
// to (may be "").
func (s *Store) CreateAuthToken(ctx context.Context, userID int64, purpose, token, email string, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO auth_tokens (user_id, purpose, token, email, expires_at)
		VALUES ($1, $2, $3, $4, $5)`,
		userID, purpose, token, nullStr(email), expiresAt)
	if err != nil {
		return fmt.Errorf("store: create auth token: %w", err)
	}
	return nil
}

// ConsumeAuthToken atomically validates and spends a token: it must exist, be of
// the given purpose, be unused, and be unexpired. On success it stamps used_at
// and returns the owning user id plus the address the token was issued to (may
// be "" for tokens stored without one). Returns ErrTokenInvalid otherwise. The
// single-statement UPDATE...WHERE...RETURNING makes redemption race-safe (two
// concurrent redemptions: only one matches the unused row).
//
// The email is returned, not just the user id, because a token authorises one
// ADDRESS — see SetEmailVerified, which will not mark an address confirmed that
// the token was never sent to.
func (s *Store) ConsumeAuthToken(ctx context.Context, purpose, token string) (int64, string, error) {
	var userID sql.NullInt64
	var email sql.NullString
	err := s.db.QueryRowContext(ctx, `
		UPDATE auth_tokens
		SET used_at = now()
		WHERE token = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
		RETURNING user_id, email`, token, purpose).Scan(&userID, &email)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", ErrTokenInvalid
	}
	if err != nil {
		return 0, "", fmt.Errorf("store: consume auth token: %w", err)
	}
	if !userID.Valid {
		return 0, "", ErrTokenInvalid
	}
	return userID.Int64, email.String, nil
}

// SetEmailVerified marks a user's email confirmed, but only while the address on
// file is still the one the token was mailed to. ok is false when it is not.
//
// A verification token proves control of ONE address; the flag it sets describes
// whatever address the account currently holds. Marking the user verified
// without re-checking would let someone verify an address they never controlled:
// request a link for their own, change the account's email to a victim's, then
// redeem. There is no email-change endpoint today, so this is a door being
// closed before it opens rather than a live hole.
//
// The comparison mirrors EmailForUser — users.email when set, else the linked
// OAuth identity's — because that is where the token's address came from, and a
// Google account with no users.email row must still be able to verify.
func (s *Store) SetEmailVerified(ctx context.Context, userID int64, email string) (bool, error) {
	if email == "" {
		return false, nil
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE users u
		SET email_verified = true, updated_at = now()
		WHERE u.id = $1
		  AND lower($2) = lower(COALESCE(NULLIF(u.email, ''), (
		        SELECT oi.email FROM oauth_identities oi WHERE oi.user_id = u.id LIMIT 1
		      )))`, userID, email)
	if err != nil {
		return false, fmt.Errorf("store: set email verified: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: set email verified rows: %w", err)
	}
	return n > 0, nil
}
