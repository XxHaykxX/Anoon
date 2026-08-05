package api

import (
	"encoding/json"
	"net/http"

	"anoon/companion/internal/push"
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
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save subscription")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// pushUnsubscribeRequest is the body of POST /push/unsubscribe.
type pushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

// handlePushUnsubscribe deletes a subscription by endpoint. Not scoped to the
// caller's own subscriptions by user id: the endpoint itself is the unguessable
// per-device secret (matches how the browser only ever knows its own), and this
// keeps unsubscribe working even if the session has expired client-side.
func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r); !ok {
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
	if err := s.Store.DeletePushSubscription(r.Context(), req.Endpoint); err != nil {
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
