package api

import (
	"context"
	"errors"
	"testing"

	"anoon/companion/internal/store"
)

// fakeBanSweepStore records what the sweep retired, so a pass can be checked
// without a Postgres.
type fakeBanSweepStore struct {
	due     []store.DueBan
	dueErr  error
	expired []int64
	expErr  error
}

func (f *fakeBanSweepStore) DueBans(context.Context) ([]store.DueBan, error) {
	return f.due, f.dueErr
}

func (f *fakeBanSweepStore) ExpireBanFor(_ context.Context, userID int64) error {
	if f.expErr != nil {
		return f.expErr
	}
	f.expired = append(f.expired, userID)
	return nil
}

// TestSweepLeavesBanActiveWhenTinodeRefuses is the regression for a silent,
// permanent lockout: the ban row used to be retired first, so a ROOT-stream
// outage during the sweep left companion saying "not banned" while Tinode kept
// the account suspended — nothing remembered the lift was still owed, and the
// user could never log in again. The row must survive a failed unban so the next
// tick retries, and one failure must not stop the users behind it.
func TestSweepLeavesBanActiveWhenTinodeRefuses(t *testing.T) {
	st := &fakeBanSweepStore{due: []store.DueBan{
		{UserID: 1, TinodeUID: "usrBroken"},
		{UserID: 2, TinodeUID: "usrOK"},
	}}
	var attempted []string
	sweepDueBans(context.Background(), st, func(_ context.Context, uid string) error {
		attempted = append(attempted, uid)
		if uid == "usrBroken" {
			return errors.New("root stream down")
		}
		return nil
	})

	if len(attempted) != 2 {
		t.Fatalf("expected both uids to be attempted, got %v", attempted)
	}
	if len(st.expired) != 1 || st.expired[0] != 2 {
		t.Fatalf("expired = %v, want only user 2 — user 1 is still suspended in Tinode", st.expired)
	}
}

// TestSweepExpiresOnlyAfterUnbanSucceeds is the ordering itself: no ban row may
// be retired before its unban has been accepted.
func TestSweepExpiresOnlyAfterUnbanSucceeds(t *testing.T) {
	st := &fakeBanSweepStore{due: []store.DueBan{{UserID: 5, TinodeUID: "usr5"}}}
	unbanned := false
	sweepDueBans(context.Background(), st, func(context.Context, string) error {
		if len(st.expired) != 0 {
			t.Fatalf("ban was retired before Tinode was asked to lift it")
		}
		unbanned = true
		return nil
	})
	if !unbanned || len(st.expired) != 1 {
		t.Fatalf("unbanned=%v expired=%v, want the ban lifted then retired", unbanned, st.expired)
	}
}

// TestSweepRetiresBansWithoutTinodeAccount: a row whose account never got a
// Tinode uid has nothing to lift. Treating that as a failed unban would pin the
// ban 'active' for good.
func TestSweepRetiresBansWithoutTinodeAccount(t *testing.T) {
	st := &fakeBanSweepStore{due: []store.DueBan{{UserID: 9}}}
	sweepDueBans(context.Background(), st, func(context.Context, string) error {
		t.Fatal("unban must not be called without a uid")
		return nil
	})
	if len(st.expired) != 1 || st.expired[0] != 9 {
		t.Fatalf("expired = %v, want user 9 retired", st.expired)
	}
}

// TestSweepDoesNothingWhenListingFails — a failed read is not an empty result.
func TestSweepDoesNothingWhenListingFails(t *testing.T) {
	st := &fakeBanSweepStore{dueErr: errors.New("db down")}
	sweepDueBans(context.Background(), st, func(context.Context, string) error {
		t.Fatal("unban must not be called when the due-ban listing failed")
		return nil
	})
	if len(st.expired) != 0 {
		t.Fatalf("expired = %v, want nothing", st.expired)
	}
}
