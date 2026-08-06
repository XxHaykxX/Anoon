package store

import (
	"context"
	"database/sql/driver"
	"reflect"
	"strings"
	"testing"
)

// TestEscalateMediaByTopicOwnerScopesToOwner pins the owner binding the p2p
// escalation path relies on: p2p topic names are per-user, so `usrB` names
// every chat anyone has with B. Without the owner filter one report would flag
// strangers' media in conversations it has nothing to do with.
func TestEscalateMediaByTopicOwnerScopesToOwner(t *testing.T) {
	st, rec := newRecordingStore(t)

	if err := st.EscalateMediaByTopicOwner(context.Background(), "usrPeer", 11); err != nil {
		t.Fatalf("EscalateMediaByTopicOwner: %v", err)
	}

	stmt := rec.only(t)
	if !strings.Contains(stmt.query, "topic = $1") || !strings.Contains(stmt.query, "owner_id = $2") {
		t.Errorf("escalation is not scoped to (topic, owner) — query was:\n%s", stmt.query)
	}
	want := []driver.Value{"usrPeer", int64(11)}
	if !reflect.DeepEqual(stmt.args, want) {
		t.Errorf("args = %+v, want %+v", stmt.args, want)
	}
}

// TestEscalateMediaNoTarget covers the no-op cases: an escalation with nothing
// to select must touch no rows rather than widening to all of them.
func TestEscalateMediaNoTarget(t *testing.T) {
	ctx := context.Background()

	st, rec := newRecordingStore(t)
	if err := st.EscalateMediaByTopic(ctx, ""); err != nil {
		t.Fatalf("EscalateMediaByTopic(\"\"): %v", err)
	}
	if n := rec.count(); n != 0 {
		t.Errorf("empty topic issued %d statements, want none", n)
	}

	st, rec = newRecordingStore(t)
	if err := st.EscalateMediaByTopicOwner(ctx, "usrPeer", 0); err != nil {
		t.Fatalf("EscalateMediaByTopicOwner(owner 0): %v", err)
	}
	if err := st.EscalateMediaByTopicOwner(ctx, "", 11); err != nil {
		t.Fatalf("EscalateMediaByTopicOwner(no topic): %v", err)
	}
	if n := rec.count(); n != 0 {
		t.Errorf("owner-less escalation issued %d statements, want none", n)
	}
}
