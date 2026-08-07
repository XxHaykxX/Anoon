package api

import (
	"context"
	"log"
	"time"

	"anoon/companion/internal/store"
)

// banSweepStore is the slice of the store the sweep uses. It is an interface so
// the sweep can be exercised without a Postgres (bansweep_test.go); *store.Store
// is the only production implementation.
type banSweepStore interface {
	DueBans(ctx context.Context) ([]store.DueBan, error)
	ExpireBanFor(ctx context.Context, userID int64) error
}

// RunBanSweep periodically retires temporary bans whose expiry has passed:
// Tinode's account suspension is lifted first, and only then is the companion
// ban row marked 'expired' (see sweepDueBans for why that order). Runs until ctx
// is cancelled.
//
// Callers should not start this goroutine when interval<=0 (see
// config.Config.BanSweepInterval) — main.go checks that before calling.
func (s *Server) RunBanSweep(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		s.sweepExpiredBans(ctx)
	}
}

// sweepExpiredBans runs one sweep pass, bounded so a slow/stuck DB or a wedged
// ROOT stream can't hold the ticker loop forever. A pass cut short by the
// deadline is harmless: whatever it did not get to is still 'active' and is
// picked up by the next tick.
func (s *Server) sweepExpiredBans(ctx context.Context) {
	sweepCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	sweepDueBans(sweepCtx, s.Store, s.unbanTinodeUID)
}

// unbanTinodeUID lifts the Tinode suspension and REPORTS whether it worked.
// That is the difference from tinodeUnbanUID (admin.go), which swallows the
// error on purpose: an operator-driven unban has an operator watching the
// response and can be retried by hand, while nobody is watching a sweep.
func (s *Server) unbanTinodeUID(ctx context.Context, uid string) error {
	return s.Tinode.Unban(ctx, uid)
}

// sweepDueBans lifts every lapsed temporary ban, Tinode side first.
//
// The order is the fix for a silent lockout: the companion row and the Tinode
// account state are two separate places, and the ban row is the ONLY thing that
// remembers a suspension is still owed a lift. Retiring the row first (what this
// used to do) meant that a ROOT-stream outage during the sweep left companion
// saying "not banned" while Tinode kept the account suspended — the user could
// never log in again, no later pass would look at them, and the ban list showed
// nothing wrong. Now a failed unban simply leaves the row 'active' and the next
// tick tries again.
//
// Note this costs the user nothing in the meantime: companion-side enforcement
// (Store.ModerationStatus, ProfileRow.banned, the roulette gate) keys off
// ban_until, which has already passed, so the still-'active' row is a retry
// ledger and not an extension of the punishment.
func sweepDueBans(ctx context.Context, st banSweepStore, unban func(context.Context, string) error) {
	due, err := st.DueBans(ctx)
	if err != nil {
		log.Printf("ban sweep: list due bans: %v", err)
		return
	}
	for _, d := range due {
		// An empty uid is a row whose account never got a Tinode side; there is
		// nothing to lift, and retrying forever would pin it 'active' for good.
		if d.TinodeUID != "" {
			if err := unban(ctx, d.TinodeUID); err != nil {
				log.Printf("ban sweep: tinode unban uid=%s (user %d) failed, ban stays active for the next pass: %v",
					d.TinodeUID, d.UserID, err)
				continue
			}
		}
		if err := st.ExpireBanFor(ctx, d.UserID); err != nil {
			log.Printf("ban sweep: expire ban for user %d: %v", d.UserID, err)
			continue
		}
		log.Printf("ban sweep: auto-unbanned user %d (temporary ban expired)", d.UserID)
	}
}
