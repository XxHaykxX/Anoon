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
// in schema_migrations. It is safe to run on every startup.
func (d *DB) Migrate(ctx context.Context) error {
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
