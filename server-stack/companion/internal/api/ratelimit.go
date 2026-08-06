package api

// ratelimit.go is companion's abuse guard for the public, unauthenticated-or-
// cheap-to-hit endpoints (#120): a hand-rolled token-bucket limiter keyed by
// BOTH client IP and caller credential, so neither a single IP nor a single
// account can flood auth/enqueue/reports/search. It has no dependency beyond the
// stdlib (golang.org/x/time/rate is not vendored) and is entirely in-memory —
// good enough for a single companion process; a Redis-backed limiter can replace
// it wholesale behind the same rateLimited() wrapper if we ever scale out.
//
// Disabled by default (config.RateLimitRPS<=0): rateLimited() returns the
// handler untouched, so there is zero overhead and zero behavior change unless
// an operator sets RATE_LIMIT_RPS.

import (
	"context"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// bucketIdleTTL is how long an untouched bucket is kept before the janitor
// evicts it. A bucket only matters while its owner is actively hitting limits;
// once idle for this long it has necessarily refilled to full, so dropping it
// loses nothing (a fresh one starts full too).
const bucketIdleTTL = 10 * time.Minute

// tokenBucket is a single lazily-refilled bucket. Not safe for concurrent use on
// its own — the owning rateLimiter serializes access under its mutex.
type tokenBucket struct {
	tokens float64   // available tokens (fractional; refills continuously)
	last   time.Time // last time tokens were recomputed
}

// take refills the bucket for the time elapsed since last, then tries to spend
// one token. It returns whether the request is allowed and, when denied, how
// long until one token is available (for the Retry-After header).
func (b *tokenBucket) take(now time.Time, rps, burst float64) (bool, time.Duration) {
	elapsed := now.Sub(b.last).Seconds()
	if elapsed < 0 {
		elapsed = 0
	}
	b.last = now
	b.tokens += elapsed * rps
	if b.tokens > burst {
		b.tokens = burst
	}
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	deficit := 1 - b.tokens
	wait := time.Duration(deficit / rps * float64(time.Second))
	return false, wait
}

// rateLimiter holds the per-key buckets for one namespace (IP or credential).
// One process-wide instance is shared, split into two maps so an IP key and a
// credential key never collide.
type rateLimiter struct {
	rps   float64
	burst float64

	mu      sync.Mutex
	ipBkts  map[string]*tokenBucket
	credBkt map[string]*tokenBucket
}

// newRateLimiter builds a limiter. Callers should only construct it when rps>0.
func newRateLimiter(rps float64, burst int) *rateLimiter {
	if burst < 1 {
		burst = 1
	}
	return &rateLimiter{
		rps:     rps,
		burst:   float64(burst),
		ipBkts:  make(map[string]*tokenBucket),
		credBkt: make(map[string]*tokenBucket),
	}
}

// allow spends one token from the given map's bucket for key.
func (rl *rateLimiter) allow(m map[string]*tokenBucket, key string, now time.Time) (bool, time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	b := m[key]
	if b == nil {
		b = &tokenBucket{tokens: rl.burst, last: now}
		m[key] = b
	}
	return b.take(now, rl.rps, rl.burst)
}

// runJanitor evicts idle buckets on a ticker until ctx is cancelled, bounding
// memory under a churn of distinct IPs/credentials (e.g. a scan). Started from
// main only when rate limiting is enabled.
func (rl *rateLimiter) runJanitor(ctx context.Context) {
	ticker := time.NewTicker(bucketIdleTTL)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		cutoff := time.Now().Add(-bucketIdleTTL)
		rl.mu.Lock()
		for _, m := range []map[string]*tokenBucket{rl.ipBkts, rl.credBkt} {
			for k, b := range m {
				if b.last.Before(cutoff) {
					delete(m, k)
				}
			}
		}
		rl.mu.Unlock()
	}
}

// RunRateLimitJanitor runs the limiter's idle-bucket eviction loop until ctx is
// cancelled. main.go starts it only when rate limiting is enabled; it is a
// no-op if the limiter is nil (defensive — main gates this already).
func (s *Server) RunRateLimitJanitor(ctx context.Context) {
	if s.Limiter == nil {
		return
	}
	s.Limiter.runJanitor(ctx)
}

// rateLimited wraps a handler with the IP + credential token-bucket gate. When
// the limiter is nil (disabled), it returns next unchanged. A request must pass
// BOTH its IP bucket and (when a credential is present) its credential bucket;
// the first to deny sets Retry-After and returns 429. The credential key is the
// bearer token / dev-auth header — a cheap stand-in for the user id that avoids
// a token-resolution round-trip in the hot path (same credential = same user).
func (s *Server) rateLimited(next http.HandlerFunc) http.HandlerFunc {
	rl := s.Limiter
	if rl == nil {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		now := time.Now()
		if ok, retry := rl.allow(rl.ipBkts, clientIP(r), now); !ok {
			writeRateLimited(w, retry)
			return
		}
		if cred := credentialKey(r); cred != "" {
			if ok, retry := rl.allow(rl.credBkt, cred, now); !ok {
				writeRateLimited(w, retry)
				return
			}
		}
		next(w, r)
	}
}

// writeRateLimited emits a 429 with a Retry-After header (whole seconds, min 1)
// and the standard JSON error envelope.
func writeRateLimited(w http.ResponseWriter, retry time.Duration) {
	secs := int(math.Ceil(retry.Seconds()))
	if secs < 1 {
		secs = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	writeError(w, http.StatusTooManyRequests, "rate_limited", "too many requests; slow down and retry")
}

// clientIP extracts the caller's IP for per-IP limiting.
//
// X-Forwarded-For is honored only when the direct peer is a trusted proxy (see
// trustedPeer), and the hop taken is the LAST one, never the first. Caddy
// *appends* its own view of the client to whatever X-Forwarded-For the client
// sent, so the leading entries are attacker-controlled: keying buckets on the
// first one hands out a fresh bucket per request and disables per-IP limiting
// altogether. The last entry is the one our own edge wrote, i.e. the address
// that actually opened the connection to Caddy.
//
// With no proxy in front (plain `go run`, or the port companion publishes in
// the dev compose) the header is ignored entirely and RemoteAddr's host is
// used — which is already the real client, so local dev keeps working and
// cannot be spoofed by sending the header.
func clientIP(r *http.Request) string {
	peer := remoteHost(r)
	if trustedPeer(peer) {
		if hop := lastForwardedHop(r.Header.Get("X-Forwarded-For")); hop != "" {
			return hop
		}
	}
	return peer
}

// remoteHost is RemoteAddr with the port stripped (RemoteAddr as-is when it
// does not carry one).
func remoteHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// trustedPeer reports whether the connection's direct peer may speak for the
// client through X-Forwarded-For. companion is never published to the internet
// itself: in prod Caddy reaches it over the compose bridge network, in dev the
// caller is loopback — both private. So "the peer is private" is exactly "our
// own proxy (or the developer) is in front". A request arriving straight from a
// public address means companion got exposed by mistake; there is no proxy to
// have written the header, so we ignore it and limit on the real peer.
func trustedPeer(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

// lastForwardedHop returns the final entry of an X-Forwarded-For header — the
// one the nearest proxy appended — or "" when the header is absent or that
// entry is not an IP. Entries a client forged sit to the LEFT of it and are
// never consulted; a malformed last entry means the proxy misbehaved, and
// walking further left would step straight into client-controlled values, so we
// fall back to the peer instead.
func lastForwardedHop(xff string) string {
	if xff == "" {
		return ""
	}
	parts := strings.Split(xff, ",")
	last := strings.TrimSpace(parts[len(parts)-1])
	// Some proxies append host:port rather than a bare address.
	if h, _, err := net.SplitHostPort(last); err == nil {
		last = h
	}
	last = strings.Trim(last, "[]")
	if net.ParseIP(last) == nil {
		return ""
	}
	return last
}

// credentialKey returns a stable per-caller key from the request's credential
// (bearer token or dev-auth header), or "" when the request is unauthenticated
// — in which case only the per-IP bucket applies. It intentionally does NOT
// resolve the token to a user id (that would cost a Tinode round-trip per call).
func credentialKey(r *http.Request) string {
	if t := bearerToken(r); t != "" {
		return "t:" + t
	}
	if h := r.Header.Get("X-Anoon-Uid"); h != "" {
		return "u:" + h
	}
	if h := r.Header.Get("X-Anoon-Hash-Id"); h != "" {
		return "h:" + h
	}
	return ""
}
