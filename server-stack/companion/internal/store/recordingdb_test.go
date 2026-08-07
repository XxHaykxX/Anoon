package store

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"anoon/companion/internal/db"
)

// recordingdb_test.go gives the store tests a database/sql driver that records
// statements instead of running them. There is no test Postgres in this repo
// (and no third-party test dependency), so what a store method can be checked
// against without one is the SQL it issues: which columns it filters on, and
// that every value travels as a $N parameter rather than being pasted into the
// text. For the authorization fixes below that is exactly the property at
// stake. Nothing here interprets SQL.

// recordedStmt is one statement the store handed to the driver.
type recordedStmt struct {
	query string
	args  []driver.Value
}

// recorder collects the statements of one Store, and supplies what the driver
// hands back. affected is the RowsAffected of an Exec; cols/rows are what a
// Query returns — leaving rows empty is how a test says "the statement matched
// nothing", which is what QueryRow surfaces as sql.ErrNoRows.
type recorder struct {
	mu       sync.Mutex
	stmts    []recordedStmt
	affected int64
	cols     []string
	rows     [][]driver.Value
}

func (r *recorder) record(query string, args []driver.Value) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stmts = append(r.stmts, recordedStmt{query: query, args: args})
}

// only returns the single statement recorded, failing the test if the store
// issued a different number of them.
func (r *recorder) only(t *testing.T) recordedStmt {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.stmts) != 1 {
		t.Fatalf("expected exactly 1 statement, got %d: %+v", len(r.stmts), r.stmts)
	}
	return r.stmts[0]
}

// count returns how many statements were recorded.
func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.stmts)
}

type recordingDriver struct{ rec *recorder }

func (d recordingDriver) Open(string) (driver.Conn, error) { return recordingConn(d), nil }

type recordingConn struct{ rec *recorder }

func (c recordingConn) Prepare(query string) (driver.Stmt, error) {
	return recordingStmt{rec: c.rec, query: query}, nil
}
func (c recordingConn) Close() error { return nil }

// Begin hands back a no-op transaction so store methods that need one are
// exercisable. Commit/Rollback record nothing: what these tests check is the
// statements issued inside the transaction, not the transaction itself.
func (c recordingConn) Begin() (driver.Tx, error) { return recordingTx{}, nil }

type recordingTx struct{}

func (recordingTx) Commit() error   { return nil }
func (recordingTx) Rollback() error { return nil }

type recordingStmt struct {
	rec   *recorder
	query string
}

func (s recordingStmt) Close() error  { return nil }
func (s recordingStmt) NumInput() int { return -1 }

func (s recordingStmt) Exec(args []driver.Value) (driver.Result, error) {
	s.rec.record(s.query, args)
	s.rec.mu.Lock()
	defer s.rec.mu.Unlock()
	return driver.RowsAffected(s.rec.affected), nil
}

func (s recordingStmt) Query(args []driver.Value) (driver.Rows, error) {
	s.rec.record(s.query, args)
	s.rec.mu.Lock()
	defer s.rec.mu.Unlock()
	// One exception to "nothing here interprets SQL": a count(*) is answered
	// with a single scalar column holding the number of configured rows. The
	// admin list methods issue a count and then the page, and database/sql
	// insists the destination count match the column count — without this, one
	// configured row set could not serve both statements and a list method could
	// not be exercised at all.
	// Prefix, not substring: profileCols embeds a count(*) subquery, and matching
	// that would answer the page itself with a scalar.
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(s.query)), "select count(") {
		return &recordingRows{
			cols: []string{"count"},
			rows: [][]driver.Value{{int64(len(s.rec.rows))}},
		}, nil
	}
	return &recordingRows{cols: s.rec.cols, rows: s.rec.rows}, nil
}

// recordingRows replays the rows the test configured. Zero rows is the case
// that matters most here: it is what a conditional upsert produces when its
// WHERE rejects the write, and QueryRow turns it into sql.ErrNoRows.
type recordingRows struct {
	cols []string
	rows [][]driver.Value
	next int
}

func (r *recordingRows) Columns() []string { return r.cols }
func (r *recordingRows) Close() error      { return nil }

func (r *recordingRows) Next(dest []driver.Value) error {
	if r.next >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.next])
	r.next++
	return nil
}

// driverSeq keeps every test's driver name unique (sql.Register panics on a
// duplicate, and each Store needs its own recorder).
var driverSeq atomic.Int64

// newRecordingStore returns a Store whose statements are recorded, not run.
func newRecordingStore(t *testing.T) (*Store, *recorder) {
	t.Helper()
	rec := &recorder{}
	name := fmt.Sprintf("recording-%d", driverSeq.Add(1))
	sql.Register(name, recordingDriver{rec: rec})
	handle, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("open recording db: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	return New(&db.DB{DB: handle}), rec
}
