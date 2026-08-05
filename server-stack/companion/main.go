// Command companion is the anoon backend service: it brokers auth to Tinode,
// runs roulette matching, manages friends/reports, and maintains a ROOT-bot
// gRPC session to the Tinode server.
//
// Config comes entirely from the environment (see internal/config and README).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"anoon/companion/internal/api"
	"anoon/companion/internal/config"
	"anoon/companion/internal/db"
	"anoon/companion/internal/mail"
	"anoon/companion/internal/oauth"
	"anoon/companion/internal/tinode"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("companion ")

	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log.Printf("environment: ENV=%s", cfg.Env)

	// Root context cancelled on SIGINT/SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// --- Database ---------------------------------------------------------
	database, err := db.Open(ctx, cfg.DBDSN)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := database.Migrate(ctx); err != nil {
		return err
	}
	log.Printf("database ready, migrations applied")

	// --- Tinode ROOT bot --------------------------------------------------
	tn := tinode.New(cfg.TinodeGRPCAddr, cfg.RootLogin, cfg.RootSecret)
	go tn.Run(ctx) // reconnecting loop; returns when ctx is cancelled.

	// --- OAuth (Google) ---------------------------------------------------
	var google *oauth.GoogleVerifier
	if cfg.GoogleClientID != "" {
		google = oauth.NewGoogleVerifier(cfg.GoogleClientID)
		log.Printf("google sign-in enabled")
	} else {
		log.Printf("google sign-in disabled (COMPANION_GOOGLE_CLIENT_ID unset)")
	}

	// --- Outbound email (SMTP-stubbed) ------------------------------------
	mailer := mail.New(mail.Config{
		Host: cfg.SMTPHost, Port: cfg.SMTPPort, User: cfg.SMTPUser, Pass: cfg.SMTPPass, From: cfg.SMTPFrom,
	})
	if mailer.Configured() {
		log.Printf("email: SMTP host configured (%s) — NOTE: sender still stubbed, wire internal/mail.send()", cfg.SMTPHost)
	} else {
		log.Printf("email: SMTP unset — password reset / verify emails are logged, not sent (stub)")
	}

	// --- HTTP + WebSocket server ------------------------------------------
	apiSrv := api.NewServer(database, tn, google, cfg.DevAuth, cfg.AdminSecret, cfg.RouletteRecentWindow,
		cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject, cfg.CORSAllowedOrigins,
		cfg.RateLimitRPS, cfg.RateLimitBurst, mailer)
	if cfg.RouletteRecentWindow <= 0 {
		log.Printf("roulette recent-partner exclusion disabled (ROULETTE_RECENT_WINDOW<=0)")
	} else {
		log.Printf("roulette recent-partner exclusion window: %s", cfg.RouletteRecentWindow)
	}
	if cfg.DevAuth {
		log.Printf("DEV auth shortcut enabled (X-Anoon-Uid / X-Anoon-Hash-Id)")
	}
	log.Printf("CORS allowed origins: %s", strings.Join(cfg.CORSAllowedOrigins, ", "))
	if cfg.AdminSecret != "" {
		log.Printf("admin API enabled (X-Companion-Admin-Secret)")
	} else {
		log.Printf("admin API disabled (COMPANION_ADMIN_SECRET unset)")
	}
	if apiSrv.Push.Enabled() {
		log.Printf("web push enabled (VAPID keypair configured)")
	} else {
		log.Printf("web push disabled (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset)")
	}
	if cfg.RateLimitRPS > 0 {
		go apiSrv.RunRateLimitJanitor(ctx)
		log.Printf("rate limiting enabled: %.3g rps, burst %d (per user + per IP)", cfg.RateLimitRPS, cfg.RateLimitBurst)
	} else {
		log.Printf("rate limiting disabled (RATE_LIMIT_RPS unset/<=0)")
	}

	// Roulette match loop: drains the queue and creates anon topics.
	go apiSrv.RunMatchLoop(ctx)

	// Message-push: re-subscribe the ROOT bot to anon chats that were live before
	// this process started, so offline-recipient push (#112) survives a restart.
	go apiSrv.RewatchActiveTopics(ctx)

	// Ban sweep: auto-lifts temporary bans whose expiry has passed.
	if cfg.BanSweepInterval > 0 {
		go apiSrv.RunBanSweep(ctx, cfg.BanSweepInterval)
		log.Printf("ban sweep enabled: interval %s", cfg.BanSweepInterval)
	} else {
		log.Printf("ban sweep disabled (BAN_SWEEP_INTERVAL<=0)")
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           apiSrv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("HTTP listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	// --- Wait for shutdown or fatal server error --------------------------
	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		log.Printf("shutdown signal received")
	}

	// Graceful shutdown of the HTTP server.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown: %v", err)
	}

	return nil
}
