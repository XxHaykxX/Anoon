package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTokenBucketTakeAndRefill(t *testing.T) {
	b := &tokenBucket{tokens: 2, last: time.Unix(0, 0)}
	now := time.Unix(0, 0)

	// Two tokens available: two immediate allows, third denied.
	if ok, _ := b.take(now, 1, 2); !ok {
		t.Fatal("first take should be allowed")
	}
	if ok, _ := b.take(now, 1, 2); !ok {
		t.Fatal("second take should be allowed")
	}
	ok, retry := b.take(now, 1, 2)
	if ok {
		t.Fatal("third take should be denied (bucket empty)")
	}
	if retry <= 0 || retry > time.Second {
		t.Fatalf("retry-after should be ~1s at 1rps, got %v", retry)
	}

	// After 1s at 1rps, exactly one token refilled -> one allow, then denied.
	now = now.Add(time.Second)
	if ok, _ := b.take(now, 1, 2); !ok {
		t.Fatal("take after 1s refill should be allowed")
	}
	if ok, _ := b.take(now, 1, 2); ok {
		t.Fatal("second take in same instant should be denied")
	}
}

func TestTokenBucketBurstCap(t *testing.T) {
	b := &tokenBucket{tokens: 0, last: time.Unix(0, 0)}
	// Idle a long time: tokens must cap at burst, not grow unbounded.
	now := time.Unix(1000, 0)
	allowed := 0
	for i := 0; i < 10; i++ {
		if ok, _ := b.take(now, 1, 3); ok {
			allowed++
		}
	}
	if allowed != 3 {
		t.Fatalf("burst cap should allow exactly 3 in one instant, got %d", allowed)
	}
}

func TestRateLimiterPerKeyIsolation(t *testing.T) {
	rl := newRateLimiter(1, 1)
	now := time.Unix(0, 0)
	if ok, _ := rl.allow(rl.ipBkts, "1.1.1.1", now); !ok {
		t.Fatal("first hit for ip A should pass")
	}
	if ok, _ := rl.allow(rl.ipBkts, "1.1.1.1", now); ok {
		t.Fatal("second immediate hit for ip A should be limited")
	}
	// A different key has its own bucket.
	if ok, _ := rl.allow(rl.ipBkts, "2.2.2.2", now); !ok {
		t.Fatal("first hit for ip B should pass independently")
	}
}

// TestClientIP pins the anti-spoofing contract: X-Forwarded-For is read from
// the RIGHT (the hop our own proxy appended) and only when the direct peer is
// that proxy. Reading it from the left — the pre-fix behavior — let a client
// mint a fresh bucket per request and turned per-IP limiting off entirely.
func TestClientIP(t *testing.T) {
	tests := []struct {
		name string
		xff  string
		addr string
		want string
	}{
		// No proxy anywhere: the connection's own address is the client. This is
		// the local dev path (`go run`, direct :8080).
		{"no header, public peer", "", "203.0.113.9:5555", "203.0.113.9"},
		{"no header, loopback peer", "", "127.0.0.1:5555", "127.0.0.1"},

		// Behind Caddy on the compose network: peer is private, so the header is
		// trusted and the last hop is Caddy's view of the client.
		{"single hop from proxy", "198.51.100.7", "10.0.0.1:80", "198.51.100.7"},
		{"chain uses last hop", "198.51.100.7, 10.0.0.2", "10.0.0.1:80", "10.0.0.2"},
		{"three hops uses last", "1.2.3.4, 5.6.7.8, 198.51.100.7", "10.0.0.1:80", "198.51.100.7"},

		// The bypass itself: the client prepends a value hoping to be keyed on it.
		// Caddy appends its own, so the forged entry must lose.
		{"forged leading entry loses", "9.9.9.9, 198.51.100.7", "10.0.0.1:80", "198.51.100.7"},
		{"forged chain of many loses", "1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.7", "10.0.0.1:80", "198.51.100.7"},

		// Companion reached directly from a public address means no proxy wrote
		// the header, so it is ignored wholesale rather than half-trusted.
		{"untrusted peer ignores header", "9.9.9.9", "203.0.113.9:5555", "203.0.113.9"},
		{"untrusted peer ignores chain", "9.9.9.9, 8.8.8.8", "203.0.113.9:5555", "203.0.113.9"},

		// Malformed final hop: fall back to the peer rather than walk left into
		// client-controlled entries.
		{"garbage last hop falls back", "198.51.100.7, not-an-ip", "10.0.0.1:80", "10.0.0.1"},
		{"empty last hop falls back", "198.51.100.7, ", "10.0.0.1:80", "10.0.0.1"},

		// Shapes real proxies emit.
		{"last hop with port", "198.51.100.7, 203.0.113.5:4444", "10.0.0.1:80", "203.0.113.5"},
		{"ipv6 last hop", "198.51.100.7, 2001:db8::1", "10.0.0.1:80", "2001:db8::1"},
		{"bracketed ipv6 with port", "198.51.100.7, [2001:db8::1]:443", "10.0.0.1:80", "2001:db8::1"},
		{"ipv6 loopback peer is trusted", "198.51.100.7", "[::1]:5555", "198.51.100.7"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = tc.addr
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := clientIP(r); got != tc.want {
				t.Fatalf("clientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestClientIPForgedHeaderDoesNotSplitBuckets is the end-to-end version of the
// bypass: one client varying the leading X-Forwarded-For entry on every request
// must keep landing in the same bucket.
func TestClientIPForgedHeaderDoesNotSplitBuckets(t *testing.T) {
	seen := make(map[string]bool)
	for _, forged := range []string{"1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"} {
		r := httptest.NewRequest(http.MethodPost, "/auth/register", nil)
		r.RemoteAddr = "10.0.0.1:80"
		r.Header.Set("X-Forwarded-For", forged+", 198.51.100.7")
		seen[clientIP(r)] = true
	}
	if len(seen) != 1 {
		t.Fatalf("forging X-Forwarded-For produced %d distinct rate-limit keys (%v), want 1", len(seen), seen)
	}
	if !seen["198.51.100.7"] {
		t.Fatalf("rate-limit key should be the proxy-appended hop, got %v", seen)
	}
}

func TestCredentialKey(t *testing.T) {
	// No credential -> empty (IP-only limiting).
	r := httptest.NewRequest(http.MethodPost, "/auth/register", nil)
	if got := credentialKey(r); got != "" {
		t.Fatalf("unauthenticated request should have empty credential key, got %q", got)
	}
	// Bearer token keys on the token.
	r = httptest.NewRequest(http.MethodPost, "/reports", nil)
	r.Header.Set("Authorization", "Bearer abc123")
	if got := credentialKey(r); got != "t:abc123" {
		t.Fatalf("bearer credential key = %q, want t:abc123", got)
	}
}
