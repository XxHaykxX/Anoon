package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
)

// handlePushVAPID is public (no auth): it returns the VAPID public key so the
// frontend can call PushManager.subscribe() before establishing a session.
// publicKey is "" when VAPID is not configured — the frontend should treat
// that as "push unavailable" rather than error.
func (s *Server) handlePushVAPID(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"publicKey": s.Push.PublicKey()})
}

// pushSubscribeRequest mirrors the browser's PushSubscription.toJSON() shape.
type pushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// handlePushSubscribe stores (or updates) the caller's PushSubscription.
func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req pushSubscribeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
		writeError(w, http.StatusBadRequest, "invalid_subscription", "endpoint and keys.p256dh/keys.auth are required")
		return
	}
	if err := s.Store.SavePushSubscription(r.Context(), u.ID, req.Endpoint, req.Keys.P256dh, req.Keys.Auth); err != nil {
		if errors.Is(err, store.ErrSubscriptionOwned) {
			// Deliberately a visible failure, not a quiet 200: the browser must
			// not be left believing push is on. Re-subscribing mints a fresh
			// endpoint, which is the client's way out of this.
			writeError(w, http.StatusConflict, "endpoint_taken",
				"this push endpoint is registered to another account; unsubscribe and subscribe again")
			return
		}
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save subscription")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// pushUnsubscribeRequest is the body of POST /push/unsubscribe.
type pushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

// handlePushUnsubscribe deletes one of the caller's own subscriptions. Scoped
// by user id and not by endpoint alone: an endpoint is not a secret we control
// — it is handed to the push service, quoted in logs and errors, and shared
// with anything that handles the subscription — so treating possession of one
// as authority to delete it lets whoever learns it silence that person's
// notifications.
func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req pushUnsubscribeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if req.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "missing_endpoint", "endpoint is required")
		return
	}
	if err := s.Store.DeletePushSubscriptionOf(r.Context(), u.ID, req.Endpoint); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not delete subscription")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handlePushTest sends the caller a test push. Useful for verifying VAPID
// delivery end to end (browser permission + service worker) without waiting
// for a real friend request or roulette match. (New-message push for offline
// recipients now lives in message_push.go, driven by the ROOT bot's {data}
// stream — see internal/tinode/client.go dispatchData.)
func (s *Server) handlePushTest(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	s.Push.SendPush(r.Context(), u.ID, push.PushPayload{
		Title: "anoon",
		Body:  "This is a test push notification.",
		Tag:   "test",
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
