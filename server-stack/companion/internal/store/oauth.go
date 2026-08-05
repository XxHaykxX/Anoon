package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrNoPending is returned by LinkOAuthUser when no pending registration exists
// for the identity — the broker step (which captures gender/age) was skipped.
var ErrNoPending = errors.New("store: no pending registration for identity")

// OAuthUserByIdentity returns the anoon user linked to (provider, subject), and
// whether such a link exists.
func (s *Store) OAuthUserByIdentity(ctx context.Context, provider, subject string) (User, bool, error) {
	u := User{}
	var uid sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.tinode_uid, u.hash_id, u.gender, u.age, u.state
		FROM oauth_identities oi
		JOIN users u ON u.id = oi.user_id
		WHERE oi.provider = $1 AND oi.subject = $2`,
		provider, subject,
	).Scan(&u.ID, &uid, &u.HashID, &u.Gender, &u.Age, &u.State)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, fmt.Errorf("store: oauth lookup: %w", err)
	}
	u.TinodeUID = uid.String
	return u, true, nil
}

// PendingExists reports whether a pending registration is stored for the
// identity (i.e. the broker captured gender/age and the rest login can proceed).
func (s *Store) PendingExists(ctx context.Context, provider, subject string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM pending_registrations WHERE provider = $1 AND subject = $2)`,
		provider, subject,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("store: pending exists: %w", err)
	}
	return exists, nil
}

// SavePendingRegistration upserts the gender/age chosen in the app for an OAuth
// identity, to be consumed when Tinode creates the account (link step).
func (s *Store) SavePendingRegistration(ctx context.Context, provider, subject, gender string, age *int, email string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO pending_registrations (provider, subject, gender, age, email)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (provider, subject)
		DO UPDATE SET gender = EXCLUDED.gender, age = EXCLUDED.age, email = EXCLUDED.email`,
		provider, subject, gender, age, nullStr(email),
	)
	if err != nil {
		return fmt.Errorf("store: save pending registration: %w", err)
	}
	return nil
}

// LinkOAuthUser creates the anoon user for a freshly created Tinode account:
// it consumes the pending registration (gender/age), allocates the next #ID,
// inserts the users row and the oauth_identities link, and clears the pending
// row — all in one transaction. Returns the created user (with HashID).
func (s *Store) LinkOAuthUser(ctx context.Context, provider, subject, email, tinodeUID string) (User, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var gender string
	var age *int
	err = tx.QueryRowContext(ctx, `
		SELECT gender, age FROM pending_registrations WHERE provider = $1 AND subject = $2`,
		provider, subject,
	).Scan(&gender, &age)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNoPending
	}
	if err != nil {
		return User{}, fmt.Errorf("store: read pending: %w", err)
	}

	u := User{Gender: gender, Age: age, TinodeUID: tinodeUID}
	err = tx.QueryRowContext(ctx, `
		INSERT INTO users (tinode_uid, hash_id, gender, age)
		VALUES ($1, nextval('hash_id_seq'), $2, $3)
		RETURNING id, hash_id, state`,
		tinodeUID, gender, age,
	).Scan(&u.ID, &u.HashID, &u.State)
	if err != nil {
		return User{}, fmt.Errorf("store: create oauth user: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO oauth_identities (provider, subject, user_id, email)
		VALUES ($1, $2, $3, $4)`,
		provider, subject, u.ID, nullStr(email),
	); err != nil {
		return User{}, fmt.Errorf("store: insert identity: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
		DELETE FROM pending_registrations WHERE provider = $1 AND subject = $2`,
		provider, subject,
	); err != nil {
		return User{}, fmt.Errorf("store: clear pending: %w", err)
	}

	if err = tx.Commit(); err != nil {
		return User{}, err
	}
	return u, nil
}

// UnlinkOAuthByTinodeUID removes all OAuth identities for a Tinode account
// (called when Tinode deletes the auth records for a user).
func (s *Store) UnlinkOAuthByTinodeUID(ctx context.Context, tinodeUID string) error {
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM oauth_identities
		WHERE user_id IN (SELECT id FROM users WHERE tinode_uid = $1)`,
		tinodeUID,
	)
	if err != nil {
		return fmt.Errorf("store: unlink oauth: %w", err)
	}
	return nil
}

// nullStr maps "" to SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
