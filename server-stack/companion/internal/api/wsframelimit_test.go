package api

import (
	"testing"
	"time"
)

// A socket may burst up to wsFrameBurst frames at once — the trickle-ICE case
// this budget is sized for — and is throttled only past that.
func TestWSFrameLimiterAllowsBurstThenThrottles(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lim := newWSFrameLimiter(now)

	for i := 0; i < wsFrameBurst; i++ {
		if !lim.allowFrame(now) {
			t.Fatalf("frame %d of the burst was rejected; the burst must pass in full", i+1)
		}
	}
	if lim.allowFrame(now) {
		t.Fatal("frame past the burst was allowed; the socket is unbounded")
	}

	// One second later the bucket has refilled by exactly wsFrameRPS.
	later := now.Add(time.Second)
	for i := 0; i < wsFrameRPS; i++ {
		if !lim.allowFrame(later) {
			t.Fatalf("refilled frame %d was rejected; refill is slower than %d/s", i+1, wsFrameRPS)
		}
	}
	if lim.allowFrame(later) {
		t.Fatal("more than one second's worth of frames passed after the burst was spent")
	}
}

// msg:sent has its own, tighter budget: spending the push bucket must not
// require spending the (much larger) overall one first, and vice versa.
func TestWSFrameLimiterPushBudgetIsSeparateAndTighter(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	lim := newWSFrameLimiter(now)

	for i := 0; i < wsPushBurst; i++ {
		if !lim.allowPush(now) {
			t.Fatalf("push %d of the burst was rejected", i+1)
		}
	}
	if lim.allowPush(now) {
		t.Fatal("push past its burst was allowed; a socket could spam notifications")
	}

	// The overall bucket is untouched by those pushes: it still has its full
	// burst, so throttling notifications never throttles call signaling.
	for i := 0; i < wsFrameBurst; i++ {
		if !lim.allowFrame(now) {
			t.Fatalf("frame %d was rejected after the push budget ran out; the buckets are entangled", i+1)
		}
	}
}

// The push budget is the tighter of the two by construction. If someone widens
// it past the overall budget the tighter gate stops meaning anything, and the
// stacking documented in wsframelimit.go stops holding.
func TestWSPushBudgetStaysTighterThanTheFrameBudget(t *testing.T) {
	if wsPushRPS >= wsFrameRPS || wsPushBurst >= wsFrameBurst {
		t.Fatalf("push budget (%d/s burst %d) must stay below the frame budget (%d/s burst %d)",
			wsPushRPS, wsPushBurst, wsFrameRPS, wsFrameBurst)
	}
}
