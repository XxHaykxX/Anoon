// Package api exposes the companion service's outward-facing REST + WebSocket
// surface for the anoon frontend: auth brokering, roulette matching, friends,
// reports, and a realtime event channel (/ws).
//
// Handlers are stubs at this stage — they return 501 Not Implemented with a
// JSON body — but the routing, JSON helpers, and WebSocket upgrade path are
// real so the server runs and /health works end to end.
package api

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"anoon/companion/internal/db"
	"anoon/companion/internal/mail"
	"anoon/companion/internal/matchmaker"
	"anoon/companion/internal/oauth"
	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
	"anoon/companion/internal/tinode"
)

// softenAfter is how long a roulette waiter keeps its age filter before it is
// relaxed to gender-only (keeps the queue draining under thin density).
const softenAfter = 45 * time.Second

// presenceThrottle is the minimum gap between actual last_seen writes for a
// single user. Every authed REST call and every WS pong wants to stamp presence;
// coalescing them to at most one UPDATE per window kills the write amplification
// while keeping the admin online view fresh enough (window << the online cutoff).
const presenceThrottle = 30 * time.Second

// Server holds dependencies shared by all handlers.
type Server struct {
	DB     *db.DB
	Store  *store.Store
	Tinode *tinode.Client
	// Google verifies Google ID tokens; nil when Google sign-in is unconfigured.
	Google *oauth.GoogleVerifier

	// Matcher is the in-memory roulette queue; Hub fans realtime events to
	// connected clients; matchNudge wakes the match loop after an enqueue.
	Matcher    *matchmaker.Matcher
	Hub        *Hub
	matchNudge chan struct{}

	// Push sends Web Push (VAPID) notifications. Always non-nil; it is a
	// documented no-op when no VAPID keypair is configured (see push.Service).
	Push *push.Service

	// Limiter is the per-IP + per-credential token-bucket abuse guard applied to
	// the public endpoints (see ratelimit.go). nil disables rate limiting
	// entirely (the default when RATE_LIMIT_RPS is unset/<=0).
	Limiter *rateLimiter

	// Mail sends transactional email (password reset / email verification, #116).
	// Currently a stub that logs; nil is safe (its methods no-op on nil).
	Mail *mail.Mailer

	// DevAuth enables the X-Anoon-Uid / X-Anoon-Hash-Id auth shortcut (no Tinode
	// token needed). For local dev/testing only.
	DevAuth bool

	// AdminSecret gates the /admin/* API (X-Companion-Admin-Secret). Empty
	// disables the admin surface (routes return 503).
	AdminSecret string

	// CORSAllowedOrigins is the allowlist withCORS checks incoming Origin
	// headers against (config.Config.CORSAllowedOrigins; see its doc comment
	// for the "*.suffix" wildcard and bare "*" semantics).
	CORSAllowedOrigins []string

	// RecentMatchWindow is how long a just-matched peer stays on a user's
	// roulette exclude list (config.RouletteRecentWindow). 0 or negative
	// disables the recent-partner exclusion entirely — handy for testing with
	// few accounts.
	RecentMatchWindow time.Duration

	// presenceMu guards presenceLast, the per-user timestamp of the last
	// last_seen write. It throttles TouchPresence so a burst of REST calls / WS
	// pongs collapses into at most one DB UPDATE per presenceThrottle window.
	// Memory is bounded by the number of distinct users ever seen this process.
	presenceMu   sync.Mutex
	presenceLast map[int64]time.Time
}

// NewServer wires dependencies into an api.Server. google may be nil to disable
// Google sign-in. devAuth enables the header-based auth shortcut.
// recentMatchWindow seeds RecentMatchWindow (see its doc comment); pass
// config.Config.RouletteRecentWindow in production. vapidPublicKey/
// vapidPrivateKey/vapidSubject configure Push; pass empty strings to disable
// push notifications entirely. corsAllowedOrigins seeds CORSAllowedOrigins;
// pass config.Config.CORSAllowedOrigins in production.
func NewServer(database *db.DB, tn *tinode.Client, google *oauth.GoogleVerifier, devAuth bool, adminSecret string, recentMatchWindow time.Duration, vapidPublicKey, vapidPrivateKey, vapidSubject string, corsAllowedOrigins []string, rateLimitRPS float64, rateLimitBurst int, mailer *mail.Mailer) *Server {
	st := store.New(database)
	var limiter *rateLimiter
	if rateLimitRPS > 0 {
		limiter = newRateLimiter(rateLimitRPS, rateLimitBurst)
	}
	s := &Server{
		DB:                 database,
		Store:              st,
		Tinode:             tn,
		Google:             google,
		Matcher:            matchmaker.New(softenAfter),
		Hub:                NewHub(),
		matchNudge:         make(chan struct{}, 1),
		Push:               push.New(st, vapidPublicKey, vapidPrivateKey, vapidSubject),
		Limiter:            limiter,
		Mail:               mailer,
		DevAuth:            devAuth,
		AdminSecret:        adminSecret,
		RecentMatchWindow:  recentMatchWindow,
		CORSAllowedOrigins: corsAllowedOrigins,
		presenceLast:       make(map[int64]time.Time),
	}
	// The ROOT bot streams incoming chat {data} here so offline recipients get
	// a push (see message_push.go / tinode.Client.SetDataHandler). Registering
	// it at construction keeps main.go's wiring unchanged.
	tn.SetDataHandler(s.onTinodeData)
	return s
}

// Handler builds the net/http router (Go 1.22 method+pattern muxing).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Liveness/readiness.
	mux.HandleFunc("GET /health", s.handleHealth)

	// Auth: OAuth broker + email/password, plus the Tinode `rest` auth hook.
	// The user-facing auth entrypoints are rate-limited (abuse guard, #120); the
	// `rest` hook is NOT — it is a trusted server-to-server call from Tinode and
	// throttling it would throttle every login under load.
	mux.HandleFunc("POST /auth/login", s.rateLimited(s.stub("auth.login")))
	mux.HandleFunc("POST /auth/register", s.rateLimited(s.handleRegister))
	mux.HandleFunc("POST /auth/oauth/google", s.rateLimited(s.handleOAuthGoogle))
	// Endpoint Tinode's `rest` auth scheme calls back into (server-to-server).
	mux.HandleFunc("POST /auth/rest", s.handleAuthRest)
	// Account recovery / email verification (#116). Rate-limited like the rest of
	// the auth surface (token-guessing + email-bombing guard). Email send is
	// SMTP-stubbed for now — see internal/mail.
	mux.HandleFunc("POST /auth/forgot", s.rateLimited(s.handleForgotPassword))
	mux.HandleFunc("POST /auth/reset", s.rateLimited(s.handleResetPassword))
	mux.HandleFunc("POST /auth/verify-email/send", s.rateLimited(s.handleVerifyEmailSend))
	mux.HandleFunc("POST /auth/verify-email/confirm", s.rateLimited(s.handleVerifyEmailConfirm))

	// Roulette matching + anon-chat lifecycle.
	mux.HandleFunc("POST /roulette/enqueue", s.rateLimited(s.handleEnqueue))
	mux.HandleFunc("POST /roulette/cancel", s.handleCancel)
	// Resync path for a dropped `matched` WS frame — the searching UI polls it
	// (read-only; see handleRouletteStatus).
	mux.HandleFunc("GET /roulette/status", s.handleRouletteStatus)
	mux.HandleFunc("POST /roulette/end", s.handleEnd)
	mux.HandleFunc("POST /roulette/rate", s.handleRate)
	mux.HandleFunc("POST /roulette/reveal", s.handleReveal)
	mux.HandleFunc("POST /roulette/reveal/respond", s.handleRevealRespond)
	mux.HandleFunc("POST /roulette/block", s.handleBlock)

	// Friends: list, requests, respond, search by #ID, block-list CRUD.
	mux.HandleFunc("GET /friends", s.handleFriendsList)
	mux.HandleFunc("POST /friends/request", s.handleFriendRequest)
	mux.HandleFunc("POST /friends/respond", s.handleFriendRespond)
	mux.HandleFunc("GET /friends/search", s.rateLimited(s.handleFriendSearch))
	// Blacklist (#111): the Settings blocklist, backed by the same 'blocked'
	// friendships rows the roulette /roulette/block path writes, so a block here
	// also excludes the pair from matchmaking.
	mux.HandleFunc("GET /friends/blocks", s.handleFriendBlocksList)
	mux.HandleFunc("POST /friends/block", s.handleFriendBlock)
	mux.HandleFunc("DELETE /friends/block/{hashId}", s.handleFriendUnblock)

	mux.HandleFunc("GET /me", s.handleMe)
	mux.HandleFunc("DELETE /me", s.handleDeleteMe)

	// Web Push (VAPID): subscribe/unsubscribe are authenticated; the VAPID
	// public key is public so the frontend can call PushManager.subscribe
	// before the user has a session.
	mux.HandleFunc("GET /push/vapid", s.handlePushVAPID)
	mux.HandleFunc("POST /push/subscribe", s.handlePushSubscribe)
	mux.HandleFunc("POST /push/unsubscribe", s.handlePushUnsubscribe)
	mux.HandleFunc("POST /push/test", s.handlePushTest)

	// Moderation.
	mux.HandleFunc("POST /reports", s.rateLimited(s.handleCreateReport))

	// Media: companion tracks refs to files uploaded straight to Tinode (see
	// media.go). Powers the admin Files/Gallery API + view-once/report
	// escalation lifecycle (COMPANION-ADMIN-API.md §4).
	mux.HandleFunc("POST /media", s.handleCreateMediaAsset)

	// Admin API (server-to-server; gated by X-Companion-Admin-Secret). See
	// COMPANION-ADMIN-API.md §1/§2 and internal/api/admin.go.
	mux.HandleFunc("GET /admin/overview", s.adminOnly(s.handleAdminOverview))
	mux.HandleFunc("GET /admin/online", s.adminOnly(s.handleAdminOnline))
	mux.HandleFunc("GET /admin/reports", s.adminOnly(s.handleAdminListReports))
	mux.HandleFunc("PATCH /admin/reports/{id}", s.adminOnly(s.handleAdminPatchReport))
	mux.HandleFunc("GET /admin/users", s.adminOnly(s.handleAdminListUsers))
	mux.HandleFunc("PATCH /admin/users/{id}", s.adminOnly(s.handleAdminPatchUser))
	mux.HandleFunc("GET /admin/bans", s.adminOnly(s.handleAdminListBans))
	mux.HandleFunc("PATCH /admin/bans/{id}", s.adminOnly(s.handleAdminPatchBan))
	mux.HandleFunc("GET /admin/media/folders", s.adminOnly(s.handleAdminMediaFolders))
	mux.HandleFunc("GET /admin/media", s.adminOnly(s.handleAdminListMedia))
	mux.HandleFunc("PATCH /admin/media/{id}", s.adminOnly(s.handleAdminPatchMedia))
	// Broadcast (#117): fan a webpush out to every subscription.
	mux.HandleFunc("POST /admin/broadcast", s.adminOnly(s.handleAdminBroadcast))

	// Realtime anoon events (match found, friend request, reveal, ban).
	mux.HandleFunc("GET /ws", s.handleWS)

	return withCORS(mux, s.CORSAllowedOrigins)
}

// withCORS wraps the mux with CORS handling gated by an origin allowlist
// (config.Config.CORSAllowedOrigins — permissive in dev, explicit in prod; see
// its doc comment) so the frontend frontend (a separate origin, e.g.
// http://localhost:3001, or a *.trycloudflare.com phone-testing tunnel) can
// call the REST API and handle preflight. We always echo the specific
// matching origin (never a literal "*") alongside Allow-Credentials, which is
// both the only spec-legal combination and what lets the allowlist double as
// a real per-origin check. The WS upgrader does its own origin check.
func withCORS(h http.Handler, allowedOrigins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); originAllowed(origin, allowedOrigins) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Anoon-Uid, X-Anoon-Hash-Id, X-Companion-Admin-Secret, X-Admin-Id, X-Admin-Role")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// originAllowed reports whether origin (the browser's Origin header) matches
// one of allowed. Entries are exact origin strings (scheme://host[:port]), a
// bare "*" (allow any — dev only, config.Load refuses it in prod), or a
// "*.suffix" wildcard matched against the origin's hostname (e.g.
// "*.trycloudflare.com" matches "https://abcd1234.trycloudflare.com").
func originAllowed(origin string, allowed []string) bool {
	if origin == "" || len(allowed) == 0 {
		return false
	}
	host := origin
	if u, err := url.Parse(origin); err == nil && u.Host != "" {
		host = u.Host
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	for _, pattern := range allowed {
		switch {
		case pattern == "*":
			return true
		case pattern == origin:
			return true
		case strings.HasPrefix(pattern, "*.") && strings.HasSuffix(host, pattern[1:]):
			return true
		}
	}
	return false
}
