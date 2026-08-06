package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// abusableRoutes are the endpoints that must sit behind the limiter. Each entry
// is a route a caller can hit repeatedly at no cost to themselves: it either
// burns an outbound call, writes to the database, or hands back an oracle.
//
// The list is asserted through the real mux rather than by reading router.go, so
// wiring a handler in without the wrapper fails here — which is how
// POST /roulette/rate came to be unlimited after the rest of its fix landed.
var abusableRoutes = []struct {
	method, path string
}{
	{"POST", "/auth/register"},
	{"POST", "/auth/oauth/google"},
	{"POST", "/auth/forgot"},
	{"POST", "/auth/reset"},
	{"POST", "/auth/verify-email/send"},
	{"POST", "/auth/verify-email/confirm"},
	{"POST", "/roulette/enqueue"},
	{"POST", "/roulette/rate"},
	// A decline is not final, so re-asking is legal — which makes a re-ask loop
	// the way to pester someone. See handleReveal for what this does not bound.
	{"POST", "/roulette/reveal"},
	{"GET", "/friends/search"},
	{"POST", "/reports"},
	{"POST", "/media"},
}

// TestAbusableRoutesAreRateLimited drives each route past its burst and expects
// a 429. The limiter runs before authentication, so unauthenticated requests are
// enough — an unlimited route answers 401 (or 400) forever instead.
func TestAbusableRoutesAreRateLimited(t *testing.T) {
	for _, rt := range abusableRoutes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			// A fresh server per route so buckets never bleed across cases.
			s := &Server{Limiter: newRateLimiter(1, 2), Hub: NewHub()}
			h := s.Handler()

			var last int
			for i := 0; i < 6; i++ {
				req := httptest.NewRequest(rt.method, rt.path, nil)
				req.RemoteAddr = "203.0.113.7:5000"
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, req)
				last = rec.Code
				if last == http.StatusTooManyRequests {
					return
				}
			}
			t.Errorf("%s %s never rate-limited: last status %d (route is not wrapped in rateLimited)",
				rt.method, rt.path, last)
		})
	}
}

// TestRateLimiterAbsentIsPassThrough guards the other direction: with no limiter
// configured the wrapper must not start rejecting traffic. RATE_LIMIT_RPS unset
// is a supported configuration (it is the dev default), and a burst of requests
// must simply pass.
func TestRateLimiterAbsentIsPassThrough(t *testing.T) {
	s := &Server{Hub: NewHub()} // Limiter nil
	h := s.Handler()

	for i := 0; i < 6; i++ {
		req := httptest.NewRequest("POST", "/roulette/rate", nil)
		req.RemoteAddr = "203.0.113.7:5000"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d was rate-limited with no limiter configured", i+1)
		}
	}
}
