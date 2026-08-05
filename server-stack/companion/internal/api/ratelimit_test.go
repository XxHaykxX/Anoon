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

func TestClientIP(t *testing.T) {
	tests := []struct {
		name string
		xff  string
		addr string
		want string
	}{
		{"remote addr", "", "203.0.113.9:5555", "203.0.113.9"},
		{"xff single", "198.51.100.7", "10.0.0.1:80", "198.51.100.7"},
		{"xff chain uses first", "198.51.100.7, 10.0.0.2", "10.0.0.1:80", "198.51.100.7"},
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
