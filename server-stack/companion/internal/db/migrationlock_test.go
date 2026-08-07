package db

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

// execCall is one recorded ExecContext from fakeExecer.
type execCall struct {
	query  string
	args   []any
	ctxErr error // ctx.Err() at call time — proves which context the helper used
}

// fakeExecer stands in for *sql.Conn so the lock helpers can be exercised
// without a Postgres. Everything these helpers do is "issue exactly this
// statement with exactly this key", which is precisely what a real database
// would NOT tell us any more clearly.
type fakeExecer struct {
	calls []execCall
	err   error
}

func (f *fakeExecer) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	f.calls = append(f.calls, execCall{query: query, args: args, ctxErr: ctx.Err()})
	if f.err != nil {
		return nil, f.err
	}
	return driverResultZero{}, nil
}

type driverResultZero struct{}

func (driverResultZero) LastInsertId() (int64, error) { return 0, nil }
func (driverResultZero) RowsAffected() (int64, error) { return 0, nil }

// onlyCall asserts exactly one statement was issued and returns it.
func onlyCall(t *testing.T, f *fakeExecer) execCall {
	t.Helper()
	if len(f.calls) != 1 {
		t.Fatalf("expected exactly 1 exec, got %d: %+v", len(f.calls), f.calls)
	}
	return f.calls[0]
}

// keyOf asserts the call passed a single int64 argument and returns it.
func keyOf(t *testing.T, c execCall) int64 {
	t.Helper()
	if len(c.args) != 1 {
		t.Fatalf("expected 1 arg, got %d: %+v", len(c.args), c.args)
	}
	k, ok := c.args[0].(int64)
	if !ok {
		t.Fatalf("expected int64 lock key, got %T (%v)", c.args[0], c.args[0])
	}
	return k
}

func TestAcquireMigrationLockUsesBlockingLock(t *testing.T) {
	f := &fakeExecer{}
	if err := acquireMigrationLock(context.Background(), f); err != nil {
		t.Fatalf("acquire: %v", err)
	}

	c := onlyCall(t, f)
	// Blocking pg_advisory_lock, NOT pg_try_advisory_lock: a second instance
	// must wait for the migration rather than boot on a half-migrated schema.
	if c.query != `SELECT pg_advisory_lock($1)` {
		t.Fatalf("unexpected acquire statement: %q", c.query)
	}
	if k := keyOf(t, c); k != migrationLockKey {
		t.Fatalf("acquire used key %d, want %d", k, migrationLockKey)
	}
}

func TestReleaseMigrationLockUnlocksSameKey(t *testing.T) {
	f := &fakeExecer{}
	if err := releaseMigrationLock(f); err != nil {
		t.Fatalf("release: %v", err)
	}

	c := onlyCall(t, f)
	if c.query != `SELECT pg_advisory_unlock($1)` {
		t.Fatalf("unexpected release statement: %q", c.query)
	}
	// Unlocking a different key would silently leave the lock held for the life
	// of the session and hang every future instance in acquire.
	if k := keyOf(t, c); k != migrationLockKey {
		t.Fatalf("release used key %d, want %d (must match acquire)", k, migrationLockKey)
	}
}

// TestReleaseMigrationLockIgnoresCallerCancellation covers the SIGTERM case: the
// root context is already dead when the deferred release runs, and the release
// must still reach Postgres. A ctx-carrying release would no-op here and leak
// the lock into the connection pool.
func TestReleaseMigrationLockIgnoresCallerCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	f := &fakeExecer{}
	if err := releaseMigrationLock(f); err != nil {
		t.Fatalf("release after cancel: %v", err)
	}
	if c := onlyCall(t, f); c.ctxErr != nil {
		t.Fatalf("release ran on a cancelled context (%v); it must use Background", c.ctxErr)
	}
	_ = ctx
}

func TestMigrationLockErrorsPropagate(t *testing.T) {
	boom := errors.New("connection reset")

	if err := acquireMigrationLock(context.Background(), &fakeExecer{err: boom}); !errors.Is(err, boom) {
		t.Fatalf("acquire error not propagated: %v", err)
	}
	// Release failure has to surface too — that is what tells Migrate to drop
	// the connection instead of returning a lock-holding session to the pool.
	if err := releaseMigrationLock(&fakeExecer{err: boom}); !errors.Is(err, boom) {
		t.Fatalf("release error not propagated: %v", err)
	}
}

// TestMigrationLockKeyIsFrozen pins the constant. Advisory locks match on the
// key alone, so changing this value does not "rename" the lock — it creates a
// second, independent one, and an old and a new companion would migrate
// concurrently during a rolling deploy. If this test fails, the change is wrong:
// restore the value rather than update the expectation.
func TestMigrationLockKeyIsFrozen(t *testing.T) {
	const frozen int64 = 0x616e6f6f6e5f6d67 // "anoon_mg"
	if migrationLockKey != frozen {
		t.Fatalf("migrationLockKey changed to %#x; it is frozen at %#x — see migrationlock.go",
			migrationLockKey, frozen)
	}
	// Postgres advisory keys are signed bigints; a negative value still works
	// but reads as a bug in pg_locks, so keep it positive.
	if migrationLockKey <= 0 {
		t.Fatalf("migrationLockKey must be positive, got %d", migrationLockKey)
	}
}
