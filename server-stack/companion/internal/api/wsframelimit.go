package api

// wsframelimit.go bounds what one authenticated /ws socket can make companion do
// (#33). The read loop is the only place an inbound client frame does anything,
// and until now it did it without any ceiling: every frame reached the dispatch
// in handleWSFrame, and the relays behind it run store lookups (MatchByTopic,
// resolveRelayTarget) and hub sends per frame, while msg:sent can trigger a web
// push to somebody else's device. A client holding a valid Tinode token could
// therefore drive unbounded DB queries — or a stream of notifications at a
// third party — from a single socket. The HTTP limiter (ratelimit.go) never saw
// any of it: /ws is one request, and everything after the upgrade is frames.
//
// Two differences from the HTTP limiter shape this one:
//
//   - Always on, not gated behind RATE_LIMIT_RPS. The HTTP limiter is off by
//     default because it fronts endpoints whose normal cost is a single handler
//     call; these frames each cost a query or a push, and there is no
//     configuration in which unlimited is the right answer.
//   - Per socket, not per IP/credential, and so it needs no shared map, no mutex
//     and no janitor: the buckets live on the connection and die with it. The
//     read loop is a single goroutine per socket, which is what makes the
//     lock-free tokenBucket safe here.
//
// Over-limit frames are DROPPED, not answered and not fatal to the socket —
// the same "a client bug here must not kill the socket" rule handleWSFrame
// already follows for malformed frames.

import "time"

const (
	// wsReadLimitBytes caps a single inbound frame. Without it gorilla buffers
	// whatever the client sends into memory before we ever look at it, so one
	// socket could allocate arbitrarily much with a single frame. The largest
	// legitimate frame is a call:offer carrying an SDP (a few KB); this leaves
	// an order of magnitude of headroom. Exceeding it fails the read, which
	// closes the socket — the client reconnects.
	wsReadLimitBytes = 64 << 10

	// wsFrameRPS/wsFrameBurst gate EVERY inbound frame, charged before the JSON
	// is even parsed. The burst is sized for trickle ICE: answering a call emits
	// a short flood of call:ice frames, which must not be clipped. Nothing a
	// real client does sustains 20 frames/s.
	wsFrameRPS   = 20
	wsFrameBurst = 60

	// wsPushRPS/wsPushBurst gate msg:sent specifically, because it is the one
	// frame type that reaches OFF the socket: it can wake another user's device
	// with a notification (see onMessageSent). The burst covers a human sending
	// a fast run of messages; the refill rate is what a flood settles down to.
	// Note the buckets stack — a msg:sent spends a token from both.
	wsPushRPS   = 2
	wsPushBurst = 10
)

// wsFrameLimiter is one socket's inbound budget. Not safe for concurrent use,
// and does not need to be: it is touched only from that socket's read loop.
type wsFrameLimiter struct {
	frames tokenBucket
	push   tokenBucket
}

// newWSFrameLimiter builds a limiter with both buckets full, so a socket that
// connects and immediately starts a call is never made to wait.
func newWSFrameLimiter(now time.Time) *wsFrameLimiter {
	return &wsFrameLimiter{
		frames: tokenBucket{tokens: wsFrameBurst, last: now},
		push:   tokenBucket{tokens: wsPushBurst, last: now},
	}
}

// allowFrame charges one frame against the socket's overall budget.
func (l *wsFrameLimiter) allowFrame(now time.Time) bool {
	ok, _ := l.frames.take(now, wsFrameRPS, wsFrameBurst)
	return ok
}

// allowPush charges one push-triggering frame (msg:sent) against the tighter
// budget, on top of the overall one.
func (l *wsFrameLimiter) allowPush(now time.Time) bool {
	ok, _ := l.push.take(now, wsPushRPS, wsPushBurst)
	return ok
}
