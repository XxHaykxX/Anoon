//go:build integration

package integration

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"anoon/companion/internal/db"
)

// migrationLockKeyLiteral mirrors the (unexported) migrationLockKey in
// internal/db/migrationlock.go. Duplicated rather than exported because the
// constant is frozen and package db has a unit test pinning it
// (TestMigrationLockKeyIsFrozen), so the two cannot drift silently.
const migrationLockKeyLiteral int64 = 0x616e6f6f6e5f6d67

func migrationDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("COMPANION_DB_DSN")
	if dsn == "" {
		t.Skip("COMPANION_DB_DSN not set; run inside the compose network to reach the db service")
	}
	return dsn
}

// TestMigrateWaitsForAdvisoryLock is the real proof that a second companion
// process cannot run migrations while a first one is mid-flight (#16, step 1).
//
// It plays the part of both instances: a hand-held advisory lock on a dedicated
// connection is "instance A is migrating", and Migrate on a separate pool is
// instance B starting up. B must block. Without the lock in db.Migrate this test
// fails by *succeeding immediately* — which is exactly the crash-loop bug, since
// B would then be racing A's CREATE TABLEs.
func TestMigrateWaitsForAdvisoryLock(t *testing.T) {
	dsn := migrationDSN(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// --- instance A: hold the lock by hand -------------------------------
	holder, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open holder: %v", err)
	}
	defer holder.Close()

	// A dedicated connection: advisory locks are session-scoped, and a pooled
	// Exec could take the lock on one backend and be read back on another.
	conn, err := holder.Conn(ctx)
	if err != nil {
		t.Fatalf("holder conn: %v", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock($1)`, migrationLockKeyLiteral); err != nil {
		t.Fatalf("hold lock: %v", err)
	}
	unlocked := false
	unlock := func() {
		if unlocked {
			return
		}
		unlocked = true
		if _, err := conn.ExecContext(context.Background(),
			`SELECT pg_advisory_unlock($1)`, migrationLockKeyLiteral); err != nil {
			t.Errorf("unlock: %v", err)
		}
	}
	defer unlock()

	// --- instance B: must block in Migrate -------------------------------
	blocked, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open blocked: %v", err)
	}
	defer blocked.Close()

	shortCtx, shortCancel := context.WithTimeout(ctx, 3*time.Second)
	defer shortCancel()
	if err := blocked.Migrate(shortCtx); err == nil {
		t.Fatal("Migrate returned while another session held the migration lock; " +
			"the advisory lock is not being taken (see internal/db/migrationlock.go)")
	}

	// --- release, and B goes through -------------------------------------
	unlock()

	if err := blocked.Migrate(ctx); err != nil {
		t.Fatalf("Migrate after lock release: %v", err)
	}
}

// TestMigrateConcurrentInstances starts several Migrate calls at once, the way a
// `docker compose up --scale companion=4` would. All must succeed: the losers
// wait, then find schema_migrations already populated and no-op. This is the
// scenario that used to end in "duplicate table" and log.Fatalf.
func TestMigrateConcurrentInstances(t *testing.T) {
	dsn := migrationDSN(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	const instances = 4
	handles := make([]*db.DB, 0, instances)
	for i := 0; i < instances; i++ {
		// Separate pools on purpose — one pool would let database/sql serialize
		// them for us and the test would prove nothing.
		h, err := db.Open(ctx, dsn)
		if err != nil {
			t.Fatalf("open %d: %v", i, err)
		}
		defer h.Close()
		handles = append(handles, h)
	}

	var (
		wg    sync.WaitGroup
		start = make(chan struct{})
		errs  = make([]error, instances)
	)
	for i, h := range handles {
		wg.Add(1)
		go func(i int, h *db.DB) {
			defer wg.Done()
			<-start // release them together
			errs[i] = h.Migrate(ctx)
		}(i, h)
	}
	close(start)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("instance %d: Migrate failed under concurrency: %v", i, err)
		}
	}
}

// TestMigrateReleasesLock guards the leak that would make this whole change
// worse than no change: (*sql.Conn).Close returns the connection to the pool
// WITHOUT ending the Postgres session, so a Migrate that forgot to unlock would
// keep the lock alive for the life of the process and hang every later instance.
// A second Migrate on a fresh pool must therefore complete promptly.
func TestMigrateReleasesLock(t *testing.T) {
	dsn := migrationDSN(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	first, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open first: %v", err)
	}
	defer first.Close()
	if err := first.Migrate(ctx); err != nil {
		t.Fatalf("first migrate: %v", err)
	}

	// first is still open, i.e. its pooled connections are still alive. If the
	// lock leaked into one of them, this call blocks forever.
	second, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open second: %v", err)
	}
	defer second.Close()

	promptCtx, promptCancel := context.WithTimeout(ctx, 10*time.Second)
	defer promptCancel()
	if err := second.Migrate(promptCtx); err != nil {
		t.Fatalf("second migrate blocked or failed — the migration lock leaked back into the pool: %v", err)
	}
}
