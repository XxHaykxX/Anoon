package api

import (
	"log"
	"net/http"

	"anoon/companion/internal/store"
)

// handleMe returns the authenticated caller's own anoon profile: the real #ID,
// gender, and self-reported age. The frontend calls GET /me right after login
// (basic scheme) to replace the synthesized placeholder with the real identity
// — without this the profile card falls back to showing the raw Tinode UID.
//
// Shape matches POST /auth/register so the frontend's User builder handles both
// the register and login paths identically.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tinodeUid": u.TinodeUID,
		"hashId":    store.FormatHashID(u.HashID),
		"hashIdNum": u.HashID,
		"gender":    u.Gender,
		"age":       u.Age,
		"state":     u.State,
	})
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
