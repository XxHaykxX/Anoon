// Package config loads companion service configuration from the environment.
//
// All configuration is passed via env vars by docker-compose (see README.md).
// The fixed contract with the orchestrator lives here — do not rename these
// keys without updating docker-compose.yml.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// defaultDevCORSOrigins is the CORS allowlist used when CORS_ALLOWED_ORIGINS is
// unset and ENV is exactly "dev". It covers the frontend dev server, the Caddy
// port the local stack actually serves the app on, and the Cloudflare quick
// tunnels used for phone testing (see README "test on phone").
// The "*.trycloudflare.com" wildcard is a dev convenience only — ENV is one of
// exactly "dev" or "prod" and defaults to "prod", so no configuration mistake
// can reach this list; prod must name its origins explicitly.
//
// Port 8088 is not optional here: everything but a bare `next dev` reaches the
// companion THROUGH Caddy (docs/SESSION-2026-08-06.md §5 — the app lives at
// http://localhost:8088/anoon), so the browser's Origin on that stack is
// :8088, not :3000/:3001. Leaving it out only broke `/ws` — REST is same-origin
// behind Caddy, so CORS never applies to it, while the WebSocket handshake
// checks Origin regardless. That asymmetry is what made the whole realtime
// layer fail silently on the local stack while every REST call kept working.
var defaultDevCORSOrigins = []string{
	"http://localhost:3000",
	"http://localhost:3001",
	"http://localhost:8088",
	"http://127.0.0.1:3000",
	"http://127.0.0.1:3001",
	"http://127.0.0.1:8088",
	"*.trycloudflare.com",
}

// minAdminTokenSecretLen is the shortest COMPANION_ADMIN_TOKEN_SECRET Load will
// accept when the key is set at all. It mirrors the admin service, which
// refuses to start below the same bound (admin/src/lib/admin-session.ts:
// `if (!s || s.length < 16) throw`) — the two must hold the identical key, so a
// value one side would reject is never a working configuration.
const minAdminTokenSecretLen = 16

// Config holds all runtime settings for the companion service.
type Config struct {
	// Env selects the deployment environment: "dev" or "prod" (default). It
	// gates production-unsafe behavior — currently the DevAuth bypass (refused
	// outright when Env is "prod") and the CORS default (permissive in dev,
	// must be explicitly configured in prod).
	//
	// The default is "prod" on purpose: every protection here keys on it, so a
	// process started without ENV (a hand-run binary, a new compose file) must
	// fail closed — "too strict, fix the config" — rather than quietly come up
	// with the dev auth bypass reachable. Local dev sets ENV=dev explicitly.
	// Env: ENV ("dev" or "prod", default "prod").
	Env string

	// Addr is the host:port the HTTP + WebSocket server binds to.
	// Env: COMPANION_ADDR (default ":8080").
	Addr string

	// DBDSN is the Postgres connection string for the `anoon` database.
	// Env: COMPANION_DB_DSN (required).
	DBDSN string

	// TinodeGRPCAddr is the address of the Tinode Node gRPC endpoint.
	// Env: TINODE_GRPC_ADDR (default "tinode:16060").
	TinodeGRPCAddr string

	// RootLogin / RootSecret are the credentials of the ROOT bot account
	// (an account flagged via `tinode-db --make_root`). The companion uses
	// them to authenticate its persistent gRPC session and act on_behalf_of
	// any user.
	// Env: COMPANION_ROOT_LOGIN / COMPANION_ROOT_SECRET.
	RootLogin  string
	RootSecret string

	// TinodeHTTPURL / TinodeAPIKey reach Tinode's file endpoint, which is HTTP
	// and not gRPC: the admin panel's media proxy (api/file.go) streams
	// attachments from there as ROOT. Tinode refuses a download without BOTH an
	// api key and an authenticated session, so neither has a useful zero value —
	// empty TinodeHTTPURL disables the proxy (the section then shows the same
	// broken attachment it did before), and the api key defaults to the same
	// stock one the frontend bundle carries.
	// Env: TINODE_HTTP_URL (default "http://tinode:6060") / TINODE_API_KEY.
	TinodeHTTPURL string
	TinodeAPIKey  string

	// GoogleClientID is the OAuth client id whose tokens we accept (the "aud"
	// claim of Google ID tokens). Empty disables Google sign-in.
	// Env: COMPANION_GOOGLE_CLIENT_ID.
	GoogleClientID string

	// DevAuth enables the header-based auth shortcut (X-Anoon-Uid /
	// X-Anoon-Hash-Id) so REST/WS callers can be exercised without a real Tinode
	// login token. DEV ONLY — Load refuses to start if this is set while
	// Env is "prod", so the bypass can never ship live by accident.
	// Env: COMPANION_DEV_AUTH ("1"/"true" to enable).
	DevAuth bool

	// CORSAllowedOrigins is the allowlist of browser origins permitted to call
	// the API cross-origin. Entries are exact origins (e.g.
	// "http://localhost:3001") or a "*.suffix" wildcard matching any subdomain
	// (e.g. "*.trycloudflare.com" for phone-testing tunnels). "*" (allow any
	// origin) is accepted in dev but refused in prod.
	// Env: CORS_ALLOWED_ORIGINS (comma-separated). Defaults to
	// defaultDevCORSOrigins when unset and Env != "prod"; required (non-empty,
	// no "*") when Env == "prod".
	CORSAllowedOrigins []string

	// AdminSecret is the shared secret the admin service must present in the
	// X-Companion-Admin-Secret header to reach the /admin/* API. When empty the
	// admin API is disabled entirely (routes return 503). It is the companion
	// side of admin's COMPANION_ADMIN_SECRET.
	// Env: COMPANION_ADMIN_SECRET.
	AdminSecret string

	// AdminTokenSecret is the HMAC key companion verifies per-operator admin
	// tokens (X-Admin-Token) with. It must equal the admin service's
	// ADMIN_SESSION_SECRET — the same HS256 key that service already signs its
	// operator sessions with.
	//
	// OPTIONAL, and empty is a fully supported mode, not a misconfiguration:
	// empty selects legacy mode (the shipped default), where the acting
	// operator's id and role come from the X-Admin-Id / X-Admin-Role headers.
	// Those are asserted by the caller, so the super_admin gate is a guardrail
	// against operator mistakes rather than a privilege boundary. Setting this
	// makes both attested. See api.adminIdentity.
	//
	// Whitespace is trimmed, and a set-but-too-short key is refused at startup
	// (minAdminTokenSecretLen): a key that cannot verify anything is worse than
	// no key at all, because it still selects attested mode — header identity is
	// then ignored and every admin request 401s, taking the whole panel down at
	// once. A typo must fail loudly at boot, not silently at runtime.
	// Env: COMPANION_ADMIN_TOKEN_SECRET.
	AdminTokenSecret string

	// RestSecret is the shared secret Tinode must present to reach
	// POST /auth/rest, the server-to-server hook its `rest` auth scheme calls
	// back into (Google sign-in). When empty the hook is disabled entirely
	// (503) — the same fail-closed convention as AdminSecret, because the hook
	// can unlink a user's OAuth identity and must never be open.
	//
	// Tinode's rest authenticator cannot set request headers, but it does carry
	// the userinfo of its configured server_url as HTTP basic auth, so the
	// secret is accepted from either position (see api.restOnly). Use a value
	// with no URL-reserved characters so it survives being embedded in a URL.
	// Env: COMPANION_REST_SECRET.
	RestSecret string

	// RouletteRecentWindow is how long a just-matched peer stays on a user's
	// roulette exclude list, so the matcher does not re-pair the same two
	// people back-to-back. 0 (or negative) disables that exclusion, which is
	// the default: the owner's rule is that the only thing standing between
	// two people is a block. On a small user base the window is also a way to
	// make the roulette look broken — both sides queue, neither is blocked,
	// and nothing happens for two hours with no explanation on screen.
	// Env: ROULETTE_RECENT_WINDOW (a Go duration string, e.g. "2h", "30s",
	// "0"). Defaults to 0 when unset or not a valid duration.
	RouletteRecentWindow time.Duration

	// VAPIDPublicKey / VAPIDPrivateKey are the P-256 VAPID keypair used to sign
	// and authenticate Web Push notifications. Empty disables push entirely
	// (internal/push.Service becomes a no-op) — generate a real pair with
	// `go run` against github.com/SherClockHolmes/webpush-go's
	// GenerateVAPIDKeys before enabling in any real environment.
	// Env: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
	VAPIDPublicKey  string
	VAPIDPrivateKey string

	// VAPIDSubject is the VAPID JWT "sub" claim (a mailto: or https: contact
	// the push service may use to reach the sender in case of abuse).
	// Env: VAPID_SUBJECT (default "mailto:admin@anoon.app").
	VAPIDSubject string

	// BanSweepInterval is how often the background job checks for temporary
	// bans whose expiry has passed and auto-lifts them (companion + Tinode
	// account state). <=0 disables the sweep entirely.
	// Env: BAN_SWEEP_INTERVAL (a Go duration string, default "60s").
	BanSweepInterval time.Duration

	// RateLimitRPS is the sustained token-bucket refill rate (requests per
	// second, per user AND per client IP) applied to the public abuse-prone
	// endpoints (auth, roulette enqueue, reports, friend search). <=0 (the
	// default, when RATE_LIMIT_RPS is unset) disables rate limiting entirely —
	// the lenient default, so nothing changes unless an operator opts in.
	// Env: RATE_LIMIT_RPS (a float, e.g. "5"). Default 0 (disabled).
	RateLimitRPS float64

	// RateLimitBurst is the token-bucket depth: the largest instantaneous burst
	// allowed before the RPS refill governs. Only meaningful when RateLimitRPS
	// > 0. Defaults to max(2*RPS, 10) when RATE_LIMIT_BURST is unset.
	// Env: RATE_LIMIT_BURST (an int).
	RateLimitBurst int

	// SMTP* configure outbound transactional email (password reset / email
	// verification, #116). Currently UNUSED — the mail sender is stubbed (it
	// logs instead of sending); these are carried through so wiring a real SMTP
	// transport later is a one-file change (internal/mail).
	// Env: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM.
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string
}

// Load reads configuration from the environment, applying defaults and
// validating that required values are present.
func Load() (*Config, error) {
	// Defaults to "prod" so a missing ENV fails closed (see Config.Env).
	env := strings.ToLower(envOr("ENV", "prod"))
	if env != "dev" && env != "prod" {
		return nil, fmt.Errorf("config: ENV must be \"dev\" or \"prod\" (got %q)", env)
	}
	isProd := env == "prod"

	c := &Config{
		Env:                  env,
		Addr:                 envOr("COMPANION_ADDR", ":8080"),
		DBDSN:                os.Getenv("COMPANION_DB_DSN"),
		TinodeGRPCAddr:       envOr("TINODE_GRPC_ADDR", "tinode:16060"),
		TinodeHTTPURL:        envOr("TINODE_HTTP_URL", "http://tinode:6060"),
		TinodeAPIKey:         envOr("TINODE_API_KEY", "AQEAAAABAAD_rAp4DJh05a1HAwFT3A6K"),
		RootLogin:            os.Getenv("COMPANION_ROOT_LOGIN"),
		RootSecret:           os.Getenv("COMPANION_ROOT_SECRET"),
		GoogleClientID:       os.Getenv("COMPANION_GOOGLE_CLIENT_ID"),
		DevAuth:              os.Getenv("COMPANION_DEV_AUTH") == "1" || os.Getenv("COMPANION_DEV_AUTH") == "true",
		AdminSecret:          os.Getenv("COMPANION_ADMIN_SECRET"),
		AdminTokenSecret:     strings.TrimSpace(os.Getenv("COMPANION_ADMIN_TOKEN_SECRET")),
		RestSecret:           strings.TrimSpace(os.Getenv("COMPANION_REST_SECRET")),
		RouletteRecentWindow: durationOr("ROULETTE_RECENT_WINDOW", 0),
		VAPIDPublicKey:       os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:      os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:         envOr("VAPID_SUBJECT", "mailto:admin@anoon.app"),
		BanSweepInterval:     durationOr("BAN_SWEEP_INTERVAL", 60*time.Second),
		RateLimitRPS:         floatOr("RATE_LIMIT_RPS", 0),
		SMTPHost:             os.Getenv("SMTP_HOST"),
		SMTPPort:             envOr("SMTP_PORT", "587"),
		SMTPUser:             os.Getenv("SMTP_USER"),
		SMTPPass:             os.Getenv("SMTP_PASS"),
		SMTPFrom:             envOr("SMTP_FROM", "no-reply@anoon.app"),
	}

	// Burst defaults to a sane depth derived from the RPS when unset; only
	// meaningful when rate limiting is enabled (RPS > 0).
	c.RateLimitBurst = intOr("RATE_LIMIT_BURST", defaultBurst(c.RateLimitRPS))

	if c.DBDSN == "" {
		return nil, fmt.Errorf("config: COMPANION_DB_DSN is required")
	}

	// #96: the dev auth bypass (X-Anoon-Uid / X-Anoon-Hash-Id, no Tinode token
	// needed) must never be reachable in production. Refuse to start rather
	// than silently force-disabling it, so a misconfigured prod deploy fails
	// loudly instead of running with a quietly-different auth posture.
	if isProd && c.DevAuth {
		return nil, fmt.Errorf("config: COMPANION_DEV_AUTH is enabled but ENV=prod — refusing to start with the auth bypass live in production")
	}

	// Leaving COMPANION_ADMIN_TOKEN_SECRET unset is legitimate (legacy header
	// mode), but setting it to something unusable is not: it still selects
	// attested mode, in which header identity is ignored, so a truncated or
	// half-pasted key 401s every admin request and darkens the panel entirely.
	// Fail at boot instead. Whitespace-only values were trimmed to "" above and
	// so land in legacy mode rather than tripping this.
	if c.AdminTokenSecret != "" && len(c.AdminTokenSecret) < minAdminTokenSecretLen {
		return nil, fmt.Errorf("config: COMPANION_ADMIN_TOKEN_SECRET is set but shorter than %d characters — it must be the admin service's ADMIN_SESSION_SECRET verbatim (which enforces the same minimum); unset it entirely for legacy header mode", minAdminTokenSecretLen)
	}

	origins, err := corsOrigins(isProd)
	if err != nil {
		return nil, err
	}
	c.CORSAllowedOrigins = origins

	return c, nil
}

// corsOrigins parses CORS_ALLOWED_ORIGINS (comma-separated) into an allowlist.
// Unset/empty falls back to defaultDevCORSOrigins, which is reachable only when
// ENV is explicitly "dev"; in prod (including the default) it is mandatory and
// may not contain the "*" wildcard.
func corsOrigins(isProd bool) ([]string, error) {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	var origins []string
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		origins = append(origins, part)
	}

	if len(origins) == 0 {
		if isProd {
			return nil, fmt.Errorf("config: CORS_ALLOWED_ORIGINS is required when ENV=prod")
		}
		return defaultDevCORSOrigins, nil
	}

	if isProd {
		for _, o := range origins {
			if o == "*" {
				return nil, fmt.Errorf("config: CORS_ALLOWED_ORIGINS may not contain \"*\" when ENV=prod")
			}
		}
	}
	return origins, nil
}

// envOr returns the value of env var key, or def when it is unset/empty.
func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// floatOr parses env var key as a float64, returning def when unset or invalid.
func floatOr(key string, def float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}

// intOr parses env var key as an int, returning def when unset or invalid.
func intOr(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// defaultBurst derives a sane token-bucket depth from the configured RPS:
// max(2*rps, 10). Returns 0 when rps<=0 (rate limiting disabled), so an unset
// RATE_LIMIT_BURST stays 0 and harmless in the disabled case.
func defaultBurst(rps float64) int {
	if rps <= 0 {
		return 0
	}
	if b := int(rps * 2); b > 10 {
		return b
	}
	return 10
}

// durationOr parses env var key as a Go duration (time.ParseDuration syntax),
// returning def when the var is unset or fails to parse. A valid zero or
// negative duration (e.g. "0") is returned as-is — it is a meaningful
// "disabled" value, not a parse error.
func durationOr(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}
