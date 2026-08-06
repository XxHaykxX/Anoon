package config

import (
	"strings"
	"testing"
)

// baseEnv sets the minimum needed for Load to succeed, and clears every var the
// tests below care about so a developer's real environment cannot leak in.
// t.Setenv restores the previous values when the test ends.
func baseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("COMPANION_DB_DSN", "postgres://postgres:pass@localhost:5432/anoon?sslmode=disable")
	for _, k := range []string{
		"ENV", "CORS_ALLOWED_ORIGINS", "COMPANION_DEV_AUTH",
		"COMPANION_ADMIN_TOKEN_SECRET", "COMPANION_REST_SECRET",
	} {
		t.Setenv(k, "")
	}
}

// An unset ENV must fail closed: prod posture, which then demands an explicit
// CORS allowlist rather than silently handing out the dev defaults.
func TestEnvDefaultsToProd(t *testing.T) {
	baseEnv(t)
	if _, err := Load(); err == nil {
		t.Fatal("unset ENV should default to prod and require CORS_ALLOWED_ORIGINS, got no error")
	} else if !strings.Contains(err.Error(), "CORS_ALLOWED_ORIGINS") {
		t.Fatalf("expected the prod CORS requirement to bite, got: %v", err)
	}

	t.Setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")
	c, err := Load()
	if err != nil {
		t.Fatalf("Load with an explicit origin: %v", err)
	}
	if c.Env != "prod" {
		t.Fatalf("Env = %q, want prod", c.Env)
	}
}

// The dev CORS convenience list (incl. the *.trycloudflare.com wildcard) must
// be reachable only when ENV is explicitly dev.
func TestDevEnvKeepsDevCORSDefaults(t *testing.T) {
	baseEnv(t)
	t.Setenv("ENV", "dev")
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Env != "dev" {
		t.Fatalf("Env = %q, want dev", c.Env)
	}
	var wildcard bool
	for _, o := range c.CORSAllowedOrigins {
		if o == "*.trycloudflare.com" {
			wildcard = true
		}
	}
	if !wildcard {
		t.Fatalf("dev should keep the tunnel wildcard, got %v", c.CORSAllowedOrigins)
	}
}

func TestAdminTokenSecret(t *testing.T) {
	const valid = "0123456789abcdef" // exactly minAdminTokenSecretLen

	tests := []struct {
		name    string
		set     string
		want    string
		wantErr bool
	}{
		{"unset stays legacy mode", "", "", false},
		// A sloppy `.env` line must collapse to legacy mode, not select
		// attested mode with a key that can never verify anything.
		{"whitespace-only collapses to legacy", "   ", "", false},
		{"surrounding whitespace is trimmed", "  " + valid + "\t", valid, false},
		{"too short is refused at boot", "short", "", true},
		{"one below the bound is refused", valid[:len(valid)-1], "", true},
		{"at the bound is accepted", valid, valid, false},
		{"longer is accepted", valid + valid, valid + valid, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			baseEnv(t)
			t.Setenv("ENV", "dev")
			t.Setenv("COMPANION_ADMIN_TOKEN_SECRET", tc.set)

			c, err := Load()
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected Load to refuse the short key, got no error")
				}
				if !strings.Contains(err.Error(), "COMPANION_ADMIN_TOKEN_SECRET") {
					t.Fatalf("error should name the offending var, got: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if c.AdminTokenSecret != tc.want {
				t.Fatalf("AdminTokenSecret = %q, want %q", c.AdminTokenSecret, tc.want)
			}
		})
	}
}

// Same whitespace hazard on the rest hook: a blank-looking value would enable
// the endpoint with a secret Tinode can never match, breaking Google sign-in
// instead of leaving the hook cleanly disabled.
func TestRestSecretIsTrimmed(t *testing.T) {
	baseEnv(t)
	t.Setenv("ENV", "dev")
	t.Setenv("COMPANION_REST_SECRET", "  \t ")
	c, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.RestSecret != "" {
		t.Fatalf("whitespace-only RestSecret = %q, want \"\" (hook disabled)", c.RestSecret)
	}
}
