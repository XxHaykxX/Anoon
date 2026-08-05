package api

import (
	"encoding/json"
	"sync"
)

// Hub routes realtime anoon events to the right user's live WebSocket
// connection(s). A user may have several sockets (phone + web); an event is
// delivered to all of them. Delivery is best-effort: if a socket's send buffer
// is full the event is dropped for that socket (the client re-syncs over REST).
type Hub struct {
	mu    sync.RWMutex
	conns map[int64]map[*wsClient]struct{} // by companion user id
}

// NewHub builds an empty Hub.
func NewHub() *Hub {
	return &Hub{conns: make(map[int64]map[*wsClient]struct{})}
}

// add registers a connection under a user id.
func (h *Hub) add(userID int64, c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[userID]
	if set == nil {
		set = make(map[*wsClient]struct{})
		h.conns[userID] = set
	}
	set[c] = struct{}{}
}

// remove deregisters a connection.
func (h *Hub) remove(userID int64, c *wsClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set := h.conns[userID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.conns, userID)
		}
	}
}

// Online reports whether the user has at least one live socket. This is the
// source of the anon-phase "online dot" (presence is intentionally not exposed
// via Tinode for anon topics — see server/ANON-PATCH.md).
func (h *Hub) Online(userID int64) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[userID]) > 0
}

// Send marshals event to JSON and pushes it to every socket of userID.
func (h *Hub) Send(userID int64, event any) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}
	h.mu.RLock()
	set := h.conns[userID]
	targets := make([]*wsClient, 0, len(set))
	for c := range set {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	for _, c := range targets {
		select {
		case c.send <- payload:
		default: // buffer full: drop; client resyncs over REST
		}
	}
}

// --- event payloads (companion -> client). Field names are frozen: the
// frontend decodes these exactly. See PLAN.md "API contract". ---

type matchedEvent struct {
	Type         string `json:"type"` // "matched"
	Topic        string `json:"topic"`
	PeerHashID   string `json:"peerHashId"`
	PeerAgeRange string `json:"peerAgeRange"`
}

type revealRequestEvent struct {
	Type       string `json:"type"` // "reveal_request"
	Topic      string `json:"topic"`
	FromHashID string `json:"fromHashId"`
}

type revealedEvent struct {
	Type            string `json:"type"` // "revealed"
	Topic           string `json:"topic"`
	PeerHashID      string `json:"peerHashId"`
	PeerDisplayName string `json:"peerDisplayName"`
}

type friendRequestEvent struct {
	Type        string `json:"type"` // "friend_request"
	FromHashID  string `json:"fromHashId"`
	DisplayName string `json:"displayName"`
}

// friendAcceptedEvent is pushed to the ORIGINAL requester when their #ID friend
// request is accepted. Carries the p2p chat topic (the accepter's uid) so the
// requester can add the friend with a working chat live — without it their
// Contacts stayed empty and no notification arrived (BUG-42).
type friendAcceptedEvent struct {
	Type        string `json:"type"` // "friend_accepted"
	HashID      string `json:"hashId"`
	DisplayName string `json:"displayName"`
	Topic       string `json:"topic"`
	Online      bool   `json:"online"`
}
