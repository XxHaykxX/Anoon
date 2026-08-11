package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

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
// The phone (#17) reuses it rather than getting an endpoint of its own: an Expo
// push token is presented as `endpoint: "expo:ExponentPushToken[…]"`, which
// makes every other path — unsubscribe, the stale-endpoint prune, the
// delete-account cleanup — work on a phone row with no change at all.
type pushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// expoRow turns an Expo push token into the push_subscriptions triple. The
// token is the endpoint (prefixed so the sender can tell the two kinds apart)
// AND both keys, which is what makes the storage layer's takeover guard mean
// "prove you hold the token" for a phone, exactly as it means "prove you hold
// the browser's keys" for a browser. Nothing else about the token is a secret
// worth protecting: it is minted per install, carries no account identity, and
// the only thing it grants is the ability to make that phone buzz.
func expoRow(token string) (endpoint, p256dh, auth string) {
	return expoEndpointPrefix + token, token, token
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
	if tok, isExpo := strings.CutPrefix(req.Endpoint, expoEndpointPrefix); isExpo {
		// Validated rather than trusted: an unchecked string here would be posted
		// to exp.host on every single message for the life of the account. The
		// keys are recomputed rather than taken from the body, so a client cannot
		// store a row whose proof-of-possession does not match its own token.
		tok = strings.TrimSpace(tok)
		if !validExpoToken(tok) {
			writeError(w, http.StatusBadRequest, "invalid_expo_token",
				"an expo: endpoint must carry a token shaped like ExponentPushToken[…]")
			return
		}
		req.Endpoint, req.Keys.P256dh, req.Keys.Auth = expoRow(tok)
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

// pushUnsubscribeRequest is the body of POST /push/unsubscribe. A phone passes
// its `expo:`-prefixed endpoint here like any browser passes its own.
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

// handlePushTest sends the caller a test push. Useful for verifying delivery
// end to end (browser permission + service worker, or phone permission + Expo
// credentials) without waiting for a real friend request or roulette match.
// Goes through the shared fan-out, so it reaches every device the caller
// registered — a test that only ever proved the browser half would be worth
// less than no test at all. (New-message push for offline recipients lives in
// message_push.go, driven by the ROOT bot's {data} stream — see
// internal/tinode/client.go dispatchData.)
func (s *Server) handlePushTest(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	s.sendPush(r.Context(), u.ID, push.PushPayload{
		Title: "anoon",
		Body:  "This is a test push notification.",
		Tag:   "test",
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
