package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// prodOrigins / devOrigins mirror the two real allowlists: prod is the single
// Caddy-served origin (config refuses "*" there), dev is the localhost frontend
// plus the *.trycloudflare.com quick tunnels used for phone testing.
var (
	prodOrigins = []string{"https://app.example.com"}
	devOrigins  = []string{"http://localhost:3000", "http://localhost:3001", "*.trycloudflare.com"}
)

func TestWSOriginAllowed(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		allowed []string
		want    bool
	}{
		// Prod: the app's own origin connects, anything else does not.
		{"prod own origin", "https://app.example.com", prodOrigins, true},
		{"prod foreign origin", "https://evil.example", prodOrigins, false},
		{"prod lookalike suffix", "https://app.example.com.evil.example", prodOrigins, false},
		{"prod wrong scheme", "http://app.example.com", prodOrigins, false},

		// Dev: the frontend dev server and the tunnel wildcard both connect.
		{"dev localhost frontend", "http://localhost:3000", devOrigins, true},
		{"dev localhost alt port", "http://localhost:3001", devOrigins, true},
		{"dev cloudflare tunnel", "https://abcd-1234.trycloudflare.com", devOrigins, true},
		{"dev foreign origin", "https://evil.example", devOrigins, false},
		{"dev tunnel lookalike", "https://trycloudflare.com.evil.example", devOrigins, false},

		// Non-browser clients (native app, curl, probes) send no Origin at all.
		// Browsers always send one on a WS handshake, so this cannot be a browser.
		{"no origin header", "", prodOrigins, true},

		// An empty allowlist must not become allow-all.
		{"empty allowlist rejects", "https://app.example.com", nil, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := wsOriginAllowed(tc.origin, tc.allowed); got != tc.want {
				t.Fatalf("wsOriginAllowed(%q, %v) = %v, want %v", tc.origin, tc.allowed, got, tc.want)
			}
		})
	}
}

// TestWSUpgraderCheckOrigin exercises the gate as the upgrader actually calls
// it — off a real request, through the server's configured allowlist.
func TestWSUpgraderCheckOrigin(t *testing.T) {
	s := &Server{CORSAllowedOrigins: prodOrigins}
	check := s.wsUpgrader().CheckOrigin

	r := httptest.NewRequest(http.MethodGet, "/ws", nil)
	r.Header.Set("Origin", "https://app.example.com")
	if !check(r) {
		t.Fatal("the app's own origin must be able to open /ws")
	}

	r = httptest.NewRequest(http.MethodGet, "/ws", nil)
	r.Header.Set("Origin", "https://evil.example")
	if check(r) {
		t.Fatal("a foreign origin must not be able to open /ws")
	}
}
