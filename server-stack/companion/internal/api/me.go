package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"anoon/companion/internal/store"
)

// handleMe returns the authenticated caller's own anoon profile: the real #ID,
// gender, self-reported age, and their monetization state. The frontend calls
// GET /me right after login (basic scheme) to replace the synthesized
// placeholder with the real identity — without this the profile card falls back
// to showing the raw Tinode UID.
//
// Shape matches POST /auth/register so the frontend's User builder handles both
// the register and login paths identically.
//
// `coins`/`subscription` are read by walletStore.fetchWallet, which is the only
// source the wallet screen has. They were missing from this response while the
// frontend already asked for them, so `me?.coins ?? 0` and
// `me?.subscription ?? "free"` always fell through to their defaults: an account
// with an active Premium row in the database showed a zero balance and the free
// tier, while the match queue — which reads the same table through
// Store.Priority — did give it priority. Same data, two answers.
//
// A failure to read the wallet is NOT fatal to the identity: the caller needs
// their #ID to finish signing in far more than they need a balance, so it is
// logged and reported as free/0 rather than turning login into an error.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	wallet, err := s.Store.WalletOf(r.Context(), u.ID)
	if err != nil {
		log.Printf("me: wallet of user %d: %v", u.ID, err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tinodeUid":    u.TinodeUID,
		"hashId":       store.FormatHashID(u.HashID),
		"hashIdNum":    u.HashID,
		"gender":       u.Gender,
		"age":          u.Age,
		"state":        u.State,
		"coins":        wallet.Coins,
		"subscription": wallet.Tier,
	})
}

// patchMeRequest is the body of PATCH /me. A field left out is left alone;
// `age: null` clears the age.
//
// Age is raw on purpose. Telling "absent" from "null" is the whole point of a
// PATCH, and neither *int nor **int can: encoding/json writes a JSON null as
// the zero value, so both arrive as a nil pointer, and an untouched age would
// be indistinguishable from a request to erase it. Only the raw bytes carry
// that difference.
type patchMeRequest struct {
	Age json.RawMessage `json:"age"`
}

// parseAgeEdit interprets the raw `age` of a PATCH /me body:
//
//	absent      → (nil, false, nil)   leave it alone
//	null        → (nil, true,  nil)   clear it
//	13..120     → (&n,  true,  nil)   set it
//	anything else                     → an error to answer 400 with
//
// The bounds match POST /auth/register, so an age that could be registered can
// also be edited to.
func parseAgeEdit(raw json.RawMessage) (age *int, present bool, err error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, false, nil
	}
	if trimmed == "null" {
		return nil, true, nil
	}
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		return nil, true, fmt.Errorf("age must be a number")
	}
	if n < 13 || n > 120 {
		return nil, true, fmt.Errorf("age must be between 13 and 120")
	}
	return &n, true, nil
}

// handlePatchMe updates the caller's own editable profile fields. Currently that
// is age alone: the display name and photo live in the account's Tinode
// `public` and the client writes them there directly, while age is companion's
// because the match queue filters on it.
//
// This endpoint did not exist, so the profile screen's age field wrote to
// browser memory and nowhere else — the value reverted on the next load, with
// no error to show for it.
//
// Gender is not editable here on purpose: it is chosen once at registration and
// drives matching and moderation.
func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req patchMeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	age, present, err := parseAgeEdit(req.Age)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_age", err.Error())
		return
	}
	if !present {
		// Nothing to change. Not an error — a save with an untouched age is the
		// normal case once other fields join this endpoint.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.Store.UpdateUserAge(r.Context(), u.ID, age); err != nil {
		log.Printf("me: update age for user %d: %v", u.ID, err)
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save profile")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteMe implements self-service account deletion (#94 frontend /
// #107 this backend): the frontend calls this first, then deletes the Tinode
// account itself (delTopic) — companion only ever touches its own database.
// Auth is the normal token path (a user can only delete themselves).
//
// The companion side is a soft-delete (see store.DeleteUser's doc comment for
// exactly what that means and why); the in-memory roulette queue is also
// evicted here since Store can't reach the live matchmaker.Matcher.
//
// Note on "idempotent": once this succeeds, the account can no longer
// authenticate at all (UserByTinodeUID excludes deleted_at rows), so a
// sequential second call 401s like any other endpoint would — it never
// reaches DeleteUser again. Store.DeleteUser's own idempotency guard instead
// covers the real double-tap case: two requests racing in on the same
// still-valid token before either has committed.
func (s *Server) handleDeleteMe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	s.Matcher.Cancel(u.ID)
	if err := s.Store.DeleteUser(r.Context(), u.ID); err != nil {
		log.Printf("me: delete account for user %d: %v", u.ID, err)
		writeError(w, http.StatusInternalServerError, "store_failed", "could not delete account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
