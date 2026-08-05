package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"anoon/companion/internal/store"
)

// registerRequest is the body of POST /auth/register.
type registerRequest struct {
	Login    string `json:"login"`    // basic-scheme username
	Password string `json:"password"` // basic-scheme password
	Gender   string `json:"gender"`   // "male" | "female" (irreversible)
	Age      *int   `json:"age"`      // optional self-reported age
	Email    string `json:"email"`    // optional contact email (for reset/verify, #116)
}

// handleRegister creates a Tinode account (anonymous {acc} — see
// tinode.CreateAccount), then allocates the next sequential five-digit #ID and
// stores the UID<->#ID mapping. Response carries the public #ID (e.g. "#00001").
//
// This is the email/password ("basic") path; Google sign-in goes through the
// rest-auth flow (see rest.go). Registration does not require the ROOT bot.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}

	req.Login = strings.TrimSpace(req.Login)
	if req.Login == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "missing_credentials", "login and password are required")
		return
	}
	if req.Gender != "male" && req.Gender != "female" {
		writeError(w, http.StatusBadRequest, "invalid_gender", "gender must be 'male' or 'female'")
		return
	}
	if req.Age != nil && (*req.Age < 13 || *req.Age > 120) {
		writeError(w, http.StatusBadRequest, "invalid_age", "age must be between 13 and 120")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// 1) Create the Tinode account (basic scheme: secret is "login:password").
	// No client tags: Tinode auto-generates the auth ("basic:") tag, and the
	// "basic:" namespace is restricted (client-supplied → 403). anoon discovery is
	// by #ID via companion, not Tinode tags.
	secret := []byte(req.Login + ":" + req.Password)
	uid, err := s.Tinode.CreateAccount(ctx, "basic", secret, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "tinode_acc_failed", err.Error())
		return
	}

	// 2) Allocate the #ID and persist the UID<->#ID mapping.
	u, err := s.Store.CreateUser(ctx, req.Gender, req.Age, uid)
	if err == nil {
		// Record the basic login (+ optional email) so account recovery (#116)
		// can re-issue the Tinode secret and match a forgot-password lookup.
		// Best-effort: registration already succeeded, so a failure here only
		// costs recoverability, not the account.
		if credErr := s.Store.SetBasicCredentials(ctx, u.ID, req.Login, strings.TrimSpace(req.Email)); credErr != nil {
			log.Printf("register: store basic credentials for user %d: %v", u.ID, credErr)
		}
	}
	if err != nil {
		// The Tinode account exists but has no companion mapping — an orphan.
		// Compensate before returning: best-effort ROOT-delete it (state:"del"),
		// falling back to suspend (state:"susp") if the ROOT stream is down, so no
		// unreachable-but-loginable account is leaked. Either failure is logged for
		// manual reconciliation; the caller still gets the original 500.
		if delErr := s.Tinode.DeleteAccount(ctx, uid); delErr != nil {
			log.Printf("register: orphan cleanup: delete uid=%s failed: %v; attempting suspend", uid, delErr)
			if banErr := s.Tinode.Ban(ctx, uid); banErr != nil {
				log.Printf("register: orphan cleanup: suspend uid=%s also failed: %v; NEEDS RECONCILIATION", uid, banErr)
			}
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not allocate #ID")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"tinodeUid": u.TinodeUID,
		"hashId":    store.FormatHashID(u.HashID),
		"hashIdNum": u.HashID,
		"gender":    u.Gender,
	})
}

// googleAuthRequest is the body of POST /auth/oauth/google. gender/age are only
// consulted on first sign-in (registration); returning users omit them.
type googleAuthRequest struct {
	IDToken string `json:"idToken"`
	Gender  string `json:"gender"`
	Age     *int   `json:"age"`
}

// handleOAuthGoogle is the frontend-facing Google broker. It verifies the Google
// ID token, and either recognizes a returning user or captures the app's
// gender/age so the subsequent Tinode `rest` login (secret = the same ID token)
// can create the account and allocate a #ID. The Tinode login token itself is
// minted by Tinode on that rest login — the client proceeds there next.
func (s *Server) handleOAuthGoogle(w http.ResponseWriter, r *http.Request) {
	if s.Google == nil {
		writeError(w, http.StatusServiceUnavailable, "google_disabled", "Google sign-in is not configured")
		return
	}

	var req googleAuthRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	id, err := s.Google.Verify(ctx, req.IDToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_token", "Google token verification failed")
		return
	}

	// Returning user?
	user, found, err := s.Store.OAuthUserByIdentity(ctx, "google", id.Subject)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "lookup failed")
		return
	}
	if found {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":    "existing",
			"tinodeUid": user.TinodeUID,
			"hashId":    store.FormatHashID(user.HashID),
			"next":      map[string]any{"scheme": "rest"}, // log into Tinode with secret = the ID token
		})
		return
	}

	// First sign-in → registration. gender is required and irreversible.
	if req.Gender != "male" && req.Gender != "female" {
		writeError(w, http.StatusBadRequest, "invalid_gender", "gender must be 'male' or 'female'")
		return
	}
	if req.Age != nil && (*req.Age < 13 || *req.Age > 120) {
		writeError(w, http.StatusBadRequest, "invalid_age", "age must be between 13 and 120")
		return
	}

	if err := s.Store.SavePendingRegistration(ctx, "google", id.Subject, req.Gender, req.Age, id.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save registration")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"status": "registered_pending",
		"next":   map[string]any{"scheme": "rest"}, // log into Tinode with secret = the ID token to finish
	})
}
