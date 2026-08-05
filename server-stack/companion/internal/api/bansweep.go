package api

import (
	"context"
	"log"
	"time"
)

// RunBanSweep periodically checks for temporary bans whose expiry has passed
// and auto-lifts them: Store.ExpireDueBans flips the companion-side state, and
// each affected user's Tinode account state is restored to "ok" (reusing the
// same tinodeUnbanUID path the admin unban/lift handlers use). Runs until ctx
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

// sweepExpiredBans runs one sweep pass, bounded so a slow/stuck DB can't wedge
// the ticker loop forever.
func (s *Server) sweepExpiredBans(ctx context.Context) {
	sweepCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	userIDs, err := s.Store.ExpireDueBans(sweepCtx)
	if err != nil {
		log.Printf("ban sweep: expire due bans: %v", err)
		return
	}
	for _, id := range userIDs {
		s.tinodeUnbanUID(sweepCtx, s.uidFor(sweepCtx, id))
		log.Printf("ban sweep: auto-unbanned user %d (temporary ban expired)", id)
	}
}
