package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
)

// friendItem is one entry in GET /friends. topic is the Tinode p2p topic to open
// the private chat (the peer's UID). online is companion-tracked (WS presence).
type friendItem struct {
	HashID       string  `json:"hashId"`
	DisplayName  string  `json:"displayName"`
	Topic        string  `json:"topic"`
	Online       bool    `json:"online"`
	LastActiveAt *string `json:"lastActiveAt"`
}

// handleFriendsList returns the caller's accepted friends.
func (s *Server) handleFriendsList(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	friends, err := s.Store.Friends(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not load friends")
		return
	}
	out := make([]friendItem, 0, len(friends))
	for _, f := range friends {
		out = append(out, friendItem{
			HashID:      store.FormatHashID(f.HashID),
			DisplayName: store.FormatHashID(f.HashID), // no nicknames: #ID is the name
			Topic:       f.TinodeUID,                  // p2p topic = peer uid
			Online:      s.Hub.Online(f.UserID),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"friends": out})
}

// hashIDRequest is the body for friend request/respond (by #ID).
type hashIDRequest struct {
	HashID string `json:"hashId"`
	Accept bool   `json:"accept,omitempty"`
}

// handleFriendRequest sends a friend request to the #ID in the body.
func (s *Server) handleFriendRequest(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req hashIDRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	n, err := parseHashID(req.HashID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hash_id", "hashId must be a #ID")
		return
	}
	target, err := s.Store.UserByHashID(r.Context(), n)
	if err != nil {
		writeError(w, http.StatusNotFound, "user_not_found", "no user with that #ID")
		return
	}
	if target.ID == u.ID {
		writeError(w, http.StatusBadRequest, "self_request", "cannot friend yourself")
		return
	}
	if err := s.Store.CreateFriendRequest(r.Context(), u.ID, target.ID, "search"); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not send request")
		return
	}
	s.Hub.Send(target.ID, friendRequestEvent{
		Type:        "friend_request",
		FromHashID:  store.FormatHashID(u.HashID),
		DisplayName: store.FormatHashID(u.HashID),
	})
	s.Push.SendPush(r.Context(), target.ID, push.PushPayload{
		Title: "anoon",
		Body:  store.FormatHashID(u.HashID) + " sent you a friend request",
		Tag:   "friend_request",
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleFriendRespond accepts or declines an incoming friend request. On accept
// it also opens the Tinode p2p chat between the two accounts.
func (s *Server) handleFriendRespond(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req hashIDRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	n, err := parseHashID(req.HashID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hash_id", "hashId must be a #ID")
		return
	}
	from, err := s.Store.UserByHashID(r.Context(), n)
	if err != nil {
		writeError(w, http.StatusNotFound, "user_not_found", "no user with that #ID")
		return
	}
	requesterUID, err := s.Store.RespondFriendRequest(r.Context(), u.ID, from.ID, req.Accept)
	if err != nil {
		writeError(w, http.StatusConflict, "respond_failed", err.Error())
		return
	}
	if req.Accept && requesterUID != "" && u.TinodeUID != "" {
		if err := s.Tinode.CreateP2P(r.Context(), u.TinodeUID, requesterUID); err != nil {
			// The friendship is recorded; the chat can be opened lazily by the
			// client too. Log and continue.
			log.Printf("friends: create p2p failed: %v", err)
		}
	}
	if req.Accept {
		// Notify the original requester live so their Contacts populate + a
		// notification/sound fires — otherwise they'd see nothing until a manual
		// refresh (BUG-42). The p2p topic to reach us (the accepter) is our uid.
		s.Hub.Send(from.ID, friendAcceptedEvent{
			Type:        "friend_accepted",
			HashID:      store.FormatHashID(u.HashID),
			DisplayName: store.FormatHashID(u.HashID),
			Topic:       u.TinodeUID,
			Online:      true,
		})
		s.Push.SendPush(r.Context(), from.ID, push.PushPayload{
			Title: "anoon",
			Body:  store.FormatHashID(u.HashID) + " принял вашу заявку в друзья",
			Tag:   "friend_accepted",
		})
	}
	// Return the p2p topic (the requester's uid) so the accepter can open the
	// chat immediately without a friends-list refresh (BUG-42).
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"hashId": store.FormatHashID(from.HashID),
		"topic":  requesterUID,
	})
}

// handleFriendSearch resolves a #ID query to a single user (search is by exact
// #ID only — there are no nicknames).
func (s *Server) handleFriendSearch(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	n, err := parseHashID(r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
		return
	}
	target, err := s.Store.UserByHashID(r.Context(), n)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": []map[string]any{{
		"hashId":      store.FormatHashID(target.HashID),
		"displayName": store.FormatHashID(target.HashID),
	}}})
}

// parseHashID parses "#00042", "00042", or "42" into the numeric #ID.
func parseHashID(s string) (int64, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "#")
	return strconv.ParseInt(s, 10, 64)
}
