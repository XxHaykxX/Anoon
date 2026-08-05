package api

// auth_recovery.go implements the password-reset and email-verification flows
// (#116). The email SEND is SMTP-stubbed (internal/mail logs instead of
// sending); everything else — token issuance, single-use redemption, and the
// ROOT-driven Tinode password reset — is real.
//
// Endpoints:
//   POST /auth/forgot              {email}              -> {queued:true}  (always 200; no existence leak)
//   POST /auth/reset               {token,newPassword}  -> {ok:true}
//   POST /auth/verify-email/send   (requireUser)        -> {queued:true}
//   POST /auth/verify-email/confirm{token}              -> {ok:true}

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"anoon/companion/internal/store"
)

const (
	// resetTokenTTL / verifyTokenTTL bound how long an issued token stays valid.
	resetTokenTTL  = time.Hour
	verifyTokenTTL = 24 * time.Hour
	// minPasswordLen is the floor enforced on a reset (defense against trivially
	// weak passwords set via the recovery path).
	minPasswordLen = 6
)

// newRecoveryToken returns a 256-bit URL-safe random token (hex). crypto/rand
// failure is fatal to the request (returns "") — the caller treats "" as an
// error rather than issuing a guessable token.
func newRecoveryToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(b[:])
}

// --- password reset ---------------------------------------------------------

type forgotRequest struct {
	Email string `json:"email"`
}

// handleForgotPassword issues a password-reset token and "emails" it. It ALWAYS
// responds {queued:true} with 200 — whether or not the email maps to an account
// — so an attacker cannot probe which emails are registered. Only basic
// (login/password) accounts can actually be reset; a Google-only account has no
// password, so no token is issued (still a queued:true response).
func (s *Server) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req forgotRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	email := strings.TrimSpace(req.Email)

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	if email != "" {
		s.issueResetToken(ctx, email)
	}
	// Uniform response regardless of outcome.
	writeJSON(w, http.StatusOK, map[string]any{"queued": true})
}

// issueResetToken is the best-effort side of forgot-password: resolve the email,
// confirm the account can be reset, issue+persist a token, and hand it to the
// (stubbed) mailer. Every failure is logged, never surfaced — the handler's
// response must not vary.
func (s *Server) issueResetToken(ctx context.Context, email string) {
	u, found, err := s.Store.UserByEmail(ctx, email)
	if err != nil {
		log.Printf("auth/forgot: lookup %q: %v", email, err)
		return
	}
	if !found {
		return
	}
	if _, ok, _ := s.Store.BasicLogin(ctx, u.ID); !ok {
		// No basic password to reset (Google account, or pre-#116 registration).
		log.Printf("auth/forgot: %q has no resettable password; skipping", email)
		return
	}
	token := newRecoveryToken()
	if token == "" {
		log.Printf("auth/forgot: token generation failed")
		return
	}
	if err := s.Store.CreateAuthToken(ctx, u.ID, "reset", token, email, time.Now().Add(resetTokenTTL)); err != nil {
		log.Printf("auth/forgot: persist token: %v", err)
		return
	}
	if err := s.Mail.SendReset(email, token); err != nil {
		log.Printf("auth/forgot: send reset email: %v", err)
	}
}

type resetRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

// handleResetPassword redeems a reset token and sets the account's new Tinode
// basic password as ROOT. The token is spent (single-use) the moment it
// validates; if the subsequent Tinode call fails the user must request a fresh
// reset (the token is deliberately not un-spent, so it can never be replayed).
func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	var req resetRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if req.Token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "token is required")
		return
	}
	if len([]rune(req.NewPassword)) < minPasswordLen {
		writeError(w, http.StatusBadRequest, "weak_password", "newPassword must be at least 6 characters")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	userID, err := s.Store.ConsumeAuthToken(ctx, "reset", req.Token)
	if errors.Is(err, store.ErrTokenInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_token", "reset link is invalid or expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not validate token")
		return
	}

	login, ok, err := s.Store.BasicLogin(ctx, userID)
	if err != nil || !ok {
		// Token was issued only for basic accounts, so this is unexpected.
		writeError(w, http.StatusConflict, "reset_unavailable", "account has no password to reset")
		return
	}
	u, err := s.Store.UserByID(ctx, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not load account")
		return
	}
	if err := s.Tinode.SetBasicPassword(ctx, u.TinodeUID, login, req.NewPassword); err != nil {
		log.Printf("auth/reset: set tinode password for user %d: %v", userID, err)
		writeError(w, http.StatusBadGateway, "tinode_failed", "could not update password; request a new reset link")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- email verification -----------------------------------------------------

// handleVerifyEmailSend issues an email-verification token for the signed-in
// user and "emails" it. Requires a valid session (a user verifies their own
// email). If the account has no email on file there is nothing to verify.
func (s *Server) handleVerifyEmailSend(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	email, hasEmail, err := s.Store.EmailForUser(ctx, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not load email")
		return
	}
	if !hasEmail {
		writeError(w, http.StatusBadRequest, "no_email", "no email on file to verify")
		return
	}
	token := newRecoveryToken()
	if token == "" {
		writeError(w, http.StatusInternalServerError, "token_failed", "could not generate token")
		return
	}
	if err := s.Store.CreateAuthToken(ctx, u.ID, "verify", token, email, time.Now().Add(verifyTokenTTL)); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not persist token")
		return
	}
	if err := s.Mail.SendVerify(email, token); err != nil {
		log.Printf("auth/verify-email/send: send email: %v", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"queued": true})
}

type verifyConfirmRequest struct {
	Token string `json:"token"`
}

// handleVerifyEmailConfirm redeems an email-verification token and marks the
// user's email confirmed.
func (s *Server) handleVerifyEmailConfirm(w http.ResponseWriter, r *http.Request) {
	var req verifyConfirmRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if req.Token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "token is required")
		return
	}
	ctx := r.Context()
	userID, err := s.Store.ConsumeAuthToken(ctx, "verify", req.Token)
	if errors.Is(err, store.ErrTokenInvalid) {
		writeError(w, http.StatusBadRequest, "invalid_token", "verification link is invalid or expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not validate token")
		return
	}
	if err := s.Store.SetEmailVerified(ctx, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not mark email verified")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
