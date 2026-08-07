package db

// migrationlock.go serializes Migrate across companion processes (#16, step 1 of
// docs/SCALING-PLAN.md).
//
// Migrate's check-then-apply is not atomic: migrationApplied does a SELECT, and
// applyMigration does the DDL in a separate transaction. On one process that is
// fine — nobody else is looking. Start a second companion against the same
// database with an unapplied migration and both read "not applied", both run the
// file, and the loser hits a duplicate-object error on CREATE TABLE (0001-0004
// carry no IF NOT EXISTS). Migrate returns the error, main.go turns it into
// log.Fatalf, the container restarts, and it happens again — so the *first*
// deploy that ships a second instance together with a migration is a crash loop,
// before any of the harder scaling work (shared queue, cross-instance events)
// even gets a chance to matter.
//
// The fix is a Postgres advisory lock: a named, purely cooperative mutex that
// costs nothing to hold and needs no schema. The second instance blocks inside
// pg_advisory_lock until the first has committed, then finds schema_migrations
// already populated and walks past every file. Nothing about single-instance
// behaviour changes: an uncontended pg_advisory_lock is one round-trip that
// always succeeds.
//
// Cooperative is worth spelling out: the lock does not protect the tables, it
// only excludes callers that ask for this same key. That is enough precisely
// because Migrate is the only writer of schema_migrations, and it is also why
// the lock does not have to be held by the session that runs the DDL — see
// Migrate.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
)

// migrationLockKey identifies companion's migration lock inside Postgres'
// single, cluster-wide advisory lock space.
//
// FROZEN FOREVER. Advisory locks exclude each other by key and by nothing else,
// so two companion builds carrying different values here would take two
// different locks, happily run migrations concurrently, and land right back in
// the crash loop this file exists to prevent — with the added cruelty that it
// would only reproduce during a rolling deploy between the two versions.
//
// The value is the ASCII of "anoon_mg" read as a big-endian int64. Arbitrary, as
// any key would be; spelled this way so it is recognisable in pg_locks output
// (`SELECT * FROM pg_locks WHERE locktype = 'advisory'`) when a stuck startup
// has to be diagnosed on a live box.
const migrationLockKey int64 = 0x616e6f6f6e5f6d67

// lockExecer is the slice of a connection the lock helpers use. It exists so the
// helpers can be tested without a Postgres (migrationlock_test.go); *sql.Conn is
// the only production implementation.
type lockExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// acquireMigrationLock blocks until this process owns the migration lock.
//
// Blocking, not pg_try_advisory_lock: a second instance that finds the lock held
// must WAIT for the migration to finish and then run with the new schema. Giving
// up and starting anyway would boot it against a half-migrated database, which
// is strictly worse than the crash loop — it fails later, in a handler, with a
// missing column instead of at startup.
//
// The wait is bounded only by ctx (main.go's signal context), which is the right
// bound: a migration that takes ten minutes should hold the second instance for
// ten minutes, and an operator who wants out sends SIGTERM.
func acquireMigrationLock(ctx context.Context, c lockExecer) error {
	if _, err := c.ExecContext(ctx, `SELECT pg_advisory_lock($1)`, migrationLockKey); err != nil {
		return fmt.Errorf("db: acquire migration advisory lock: %w", err)
	}
	return nil
}

// releaseMigrationLock hands the lock back.
//
// This is mandatory, not tidiness. Advisory locks are scoped to the SESSION, and
// (*sql.Conn).Close does not end the session — it returns the connection to
// database/sql's pool with the backend still alive and still holding the lock.
// Skipping the unlock would therefore leak the lock into whatever unrelated
// query is handed that pooled connection next, and every future instance would
// hang in acquireMigrationLock until this process exited. The one case that does
// clean itself up is a crash, because then the backend really does go away.
//
// Deliberately takes no ctx and uses Background: the caller's context may already
// be cancelled (SIGTERM during a slow migration is exactly when this runs), and
// releasing is the one step that must still happen then.
func releaseMigrationLock(c lockExecer) error {
	if _, err := c.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1)`, migrationLockKey); err != nil {
		return fmt.Errorf("db: release migration advisory lock: %w", err)
	}
	return nil
}

// discardConn forces a connection out of the pool instead of returning it.
//
// Used when releaseMigrationLock failed: that connection's session may still own
// the lock, and handing it back to the pool is how the leak described above
// becomes permanent. Returning driver.ErrBadConn from Raw is database/sql's
// documented way to mark a connection unusable, so Close destroys the backend —
// and killing the backend is what actually drops the advisory lock.
func discardConn(c *sql.Conn) {
	_ = c.Raw(func(any) error { return driver.ErrBadConn })
}
