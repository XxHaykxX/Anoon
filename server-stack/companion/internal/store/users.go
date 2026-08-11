// Package store holds the companion's business-data access layer over the anoon
// Postgres database: users (#ID mapping), friendships, reports, the roulette
// queue and subscriptions. This first slice implements the #ID allocation the
// registration flow needs; the rest lands with their features.
package store

import (
	"context"
	"database/sql"
	"fmt"

	"anoon/companion/internal/db"
)

// User is one anoon account: a Tinode UID paired with a permanent 5-digit #ID.
type User struct {
	ID        int64  // internal companion row id
	TinodeUID string // Tinode account, e.g. "usr2il9suNCR_o"
	HashID    int64  // numeric #ID counter value (format 5-wide for display)
	Gender    string // "male" | "female" (irreversible)
	Age       *int   // self-reported; nil if not given
	State     string // "ok" | "susp"
}

// Store provides data access over the anoon database.
type Store struct {
	db *db.DB
}

// New wraps a database handle in a Store.
func New(database *db.DB) *Store {
	return &Store{db: database}
}

// FormatHashID renders a numeric #ID as the public "#00001" form. Values past
// 99999 simply widen (e.g. "#100000") — no format migration needed.
func FormatHashID(n int64) string {
	return fmt.Sprintf("#%05d", n)
}

// CreateUser allocates the next sequential #ID (from hash_id_seq) and inserts a
// UpdateUserAge overwrites the caller's self-reported age. A nil age clears it,
// which is the same "not stated" the column holds for an account that never
// gave one — the profile screen's age field can legitimately be emptied.
//
// Age is the one profile field that does NOT live in Tinode: the display name
// and photo ride in the account's `public`, but age is companion's, because the
// match queue filters on it. Without this method the profile screen could only
// write age into browser memory, so it silently reverted on the next load.
//
// Gender is deliberately absent: it is set once at registration and drives
// matching and moderation, so changing it is not a profile edit.
func (s *Store) UpdateUserAge(ctx context.Context, userID int64, age *int) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET age = $1 WHERE id = $2 AND deleted_at IS NULL`, age, userID)
	if err != nil {
		return fmt.Errorf("store: update age for user %d: %w", userID, err)
	}
	return nil
}

// user row mapping it to the given Tinode UID. gender is required; age and
// tinodeUID may be empty (age nil, uid ""). It returns the created row,
// including the assigned HashID.
func (s *Store) CreateUser(ctx context.Context, gender string, age *int, tinodeUID string) (User, error) {
	u := User{Gender: gender, Age: age, TinodeUID: tinodeUID}

	var uid sql.NullString
	if tinodeUID != "" {
		uid = sql.NullString{String: tinodeUID, Valid: true}
	}

	// real_gender mirrors the registration gender (the account's real, irreversible
	// gender used by the admin Online/Overview grouping — distinct from the anon
	// persona). Registration captures a single gender field, so they coincide here.
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO users (tinode_uid, hash_id, gender, age, real_gender)
		VALUES ($1, nextval('hash_id_seq'), $2, $3, $2)
		RETURNING id, hash_id, state`,
		uid, gender, age,
	).Scan(&u.ID, &u.HashID, &u.State)
	if err != nil {
		return User{}, fmt.Errorf("store: create user: %w", err)
	}
	return u, nil
}

// UserByHashID looks up a user by their numeric #ID. Excludes soft-deleted
// accounts (sql.ErrNoRows, same as an unknown #ID) — you can't friend-request,
// report, or block a #ID whose owner deleted their account.
func (s *Store) UserByHashID(ctx context.Context, hashID int64) (User, error) {
	u := User{HashID: hashID}
	var uid sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, tinode_uid, gender, age, state
		FROM users WHERE hash_id = $1 AND deleted_at IS NULL`, hashID,
	).Scan(&u.ID, &uid, &u.Gender, &u.Age, &u.State)
	if err != nil {
		return User{}, fmt.Errorf("store: user by hash id %d: %w", hashID, err)
	}
	u.TinodeUID = uid.String
	return u, nil
}

// UserByID looks up a user by their internal companion row id.
//
// DELIBERATELY DIFFERENT from UserByHashID and UserByTinodeUID: it does NOT
// exclude soft-deleted accounts, so it still resolves someone who has deleted
// themselves. That is not an oversight — moderation depends on it. DeleteUser
// keeps hash_id assigned precisely so reports/bans/moderator_actions retain a
// valid target, and the admin ban path reaches the account through here
// (handleAdminPatchUser, uidFor): filtering deleted_at would make a report
// against someone who deleted their account unactionable.
//
// The consequence to keep in mind: this is a lookup by INTERNAL id, never by
// anything a caller supplies, so it is not an authentication or authorization
// boundary — the two filtered lookups above are. A caller that needs "a live
// account" (rather than "the row for this id") must check State/deletion
// itself; today the only such callers are the roulette paths, which are already
// covered because DeleteUser ends the user's active matches.
func (s *Store) UserByID(ctx context.Context, id int64) (User, error) {
	u := User{ID: id}
	var uid sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT tinode_uid, hash_id, gender, age, state
		FROM users WHERE id = $1`, id,
	).Scan(&uid, &u.HashID, &u.Gender, &u.Age, &u.State)
	if err != nil {
		return User{}, fmt.Errorf("store: user by id %d: %w", id, err)
	}
	u.TinodeUID = uid.String
	return u, nil
}

// LiveUserByID is UserByID restricted to accounts that still exist: it excludes
// soft-deleted rows, returning sql.ErrNoRows for them exactly as an unknown id
// would.
//
// Use this wherever a user id is resolved in order to keep TALKING to someone —
// the roulette status resync, the reveal events, the match announcement. Those
// paths were safe before only as a side effect of DeleteUser ending the user's
// active matches, so the peer was already unreachable by the time anything
// looked them up. That ordering is load-bearing but incidental: it holds by
// accident of two unrelated pieces of code agreeing, is untested, and would
// break silently if either changed. Asking for a live user says so directly.
//
// UserByID remains the right call for moderation, which must still resolve an
// account after its owner deletes it — see its doc comment.
func (s *Store) LiveUserByID(ctx context.Context, id int64) (User, error) {
	u := User{ID: id}
	var uid sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT tinode_uid, hash_id, gender, age, state
		FROM users WHERE id = $1 AND deleted_at IS NULL`, id,
	).Scan(&uid, &u.HashID, &u.Gender, &u.Age, &u.State)
	if err != nil {
		return User{}, fmt.Errorf("store: live user by id %d: %w", id, err)
	}
	u.TinodeUID = uid.String
	return u, nil
}

// UserByTinodeUID looks up a user by their Tinode account id. This is the
// authentication join: a REST/WS caller presents a Tinode token, it resolves to
// a UID, and that UID maps to the companion user here. Excludes soft-deleted
// accounts (sql.ErrNoRows, same as an unrecognized uid) — this is the login
// gate: once DeleteUser has run, the account can no longer authenticate even
// if its Tinode side hasn't been torn down yet (see DeleteUser's doc comment).
func (s *Store) UserByTinodeUID(ctx context.Context, tinodeUID string) (User, error) {
	u := User{TinodeUID: tinodeUID}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, hash_id, gender, age, state
		FROM users WHERE tinode_uid = $1 AND deleted_at IS NULL`, tinodeUID,
	).Scan(&u.ID, &u.HashID, &u.Gender, &u.Age, &u.State)
	if err != nil {
		return User{}, fmt.Errorf("store: user by tinode uid %q: %w", tinodeUID, err)
	}
	return u, nil
}

// DeleteUser soft-deletes a companion account for self-service account
// deletion (#94/#107): it stamps users.deleted_at (never reused — hash_id
// stays assigned, so reports/bans/moderator_actions keep a valid, permanent
// target for moderation history) and hard-deletes everything that's either
// meaningless without a live account or would otherwise dangle:
//   - friendships the user appears in on either side (friend lists/pending
//     requests referencing a deleted account are just noise)
//   - roulette_queue (the DB mirror of the live matchmaker queue; the caller
//     is also responsible for evicting them from the actual in-memory queue
//     — see matchmaker.Matcher.Cancel, which this store layer can't reach)
//   - active roulette_matches involving the user are ended (status='ended',
//     ended_at=now()) so the peer isn't left talking to a ghost; past
//     ended/revealed matches are left alone as history
//   - push_subscriptions (nothing should push to a deleted account)
//   - oauth_identities (frees the linked Google id for a fresh signup)
//   - subscriptions (monetization state; nothing left to bill/entitle)
//
// media_assets/reports/bans/moderator_actions are deliberately left untouched
// — that IS the moderation history the soft-delete is meant to preserve.
//
// Idempotent: deleting an already-deleted user is a no-op (returns nil without
// re-running the cleanup). Returns sql.ErrNoRows if userID doesn't exist.
func (s *Store) DeleteUser(ctx context.Context, userID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: begin delete user tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var alreadyDeleted bool
	if err := tx.QueryRowContext(ctx,
		`SELECT deleted_at IS NOT NULL FROM users WHERE id = $1 FOR UPDATE`, userID,
	).Scan(&alreadyDeleted); err != nil {
		return fmt.Errorf("store: lookup user %d for delete: %w", userID, err)
	}
	if alreadyDeleted {
		return tx.Commit()
	}

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1`, userID); err != nil {
		return fmt.Errorf("store: delete user %d friendships: %w", userID, err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM roulette_queue WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("store: delete user %d queue entry: %w", userID, err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE roulette_matches SET status = 'ended', ended_at = now()
		WHERE (user_a = $1 OR user_b = $1) AND status = 'active'`, userID); err != nil {
		return fmt.Errorf("store: end user %d active matches: %w", userID, err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("store: delete user %d push subscriptions: %w", userID, err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM oauth_identities WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("store: delete user %d oauth identities: %w", userID, err)
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM subscriptions WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("store: delete user %d subscription: %w", userID, err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1`, userID); err != nil {
		return fmt.Errorf("store: mark user %d deleted: %w", userID, err)
	}

	return tx.Commit()
}
