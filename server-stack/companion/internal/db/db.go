// Package db owns the Postgres connection and a minimal file-based migration
// runner for the companion `anoon` database.
//
// We deliberately keep the migration machinery tiny (no external migration
// library): SQL files live in migrations/, are embedded into the binary, and
// applied in lexical order inside a single transaction each, tracked in a
// schema_migrations table. Add new files as 0002_*.sql, 0003_*.sql, ...
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"sort"
	"time"

	// pgx stdlib driver registers itself as "pgx" with database/sql.
	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// DB wraps the *sql.DB handle to the anoon database.
type DB struct {
	*sql.DB
}

// Open connects to Postgres using the given DSN and verifies the connection
// with a ping. The caller is responsible for calling Close.
func Open(ctx context.Context, dsn string) (*DB, error) {
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open: %w", err)
	}

	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(pingCtx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	return &DB{DB: sqlDB}, nil
}

// Migrate applies any embedded migration files that have not yet been recorded
// in schema_migrations. It is safe to run on every startup, and — since the
// advisory lock below — safe to run from several companion processes at once.
//
// The lock is taken on its own connection, while migrateLocked keeps running its
// statements through the pool. That split is intentional and safe: the lock's
// only job is to exclude other callers of acquireMigrationLock, so it does not
// need to sit on the session doing the DDL. Migrating on the dedicated
// connection instead would mean threading it through migrationApplied and
// applyMigration for no gain.
func (d *DB) Migrate(ctx context.Context) error {
	conn, err := d.Conn(ctx)
	if err != nil {
		return fmt.Errorf("db: migration lock: reserve connection: %w", err)
	}
	locked := true
	defer func() {
		if locked {
			// Nothing sane is left to do with the error but shout: the process is
			// about to hand this connection back to the pool, so discardConn is
			// what keeps a still-held lock from outliving us.
			if relErr := releaseMigrationLock(conn); relErr != nil {
				log.Printf("db: migration lock NOT released, dropping its connection: %v", relErr)
				discardConn(conn)
			}
		}
		_ = conn.Close()
	}()

	if err := acquireMigrationLock(ctx, conn); err != nil {
		locked = false // never taken: unlocking would just log a false warning
		return err
	}

	return d.migrateLocked(ctx)
}

// migrateLocked is the original migration walk. The caller holds the migration
// advisory lock, so the check-then-apply below has no competitor.
func (d *DB) migrateLocked(ctx context.Context) error {
	if _, err := d.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("db: ensure schema_migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("db: read migrations dir: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		applied, err := d.migrationApplied(ctx, name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		if err := d.applyMigration(ctx, name); err != nil {
			return fmt.Errorf("db: apply %s: %w", name, err)
		}
	}
	return nil
}

func (d *DB) migrationApplied(ctx context.Context, version string) (bool, error) {
	var exists bool
	err := d.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).
		Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("db: check migration %s: %w", version, err)
	}
	return exists, nil
}

func (d *DB) applyMigration(ctx context.Context, name string) error {
	body, err := migrationFiles.ReadFile("migrations/" + name)
	if err != nil {
		return err
	}

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, string(body)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1)`, name); err != nil {
		return err
	}
	return tx.Commit()
}
