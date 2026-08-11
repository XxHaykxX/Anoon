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

	// A block has to stop this. Until now it only fed the roulette's exclude set,
	// so someone you blocked could still send you requests — each one firing a WS
	// event AND a push at you, which is the harassment the block was meant to
	// end. The directed block row is the other way round from this request, so
	// nothing collided and the insert simply succeeded.
	//
	// Answered with a plain 200 and no request written: an explicit error would
	// tell the sender they have been blocked, which is exactly what the person
	// who blocked them should not have to disclose. From the sender's side this
	// is indistinguishable from a request that was delivered and ignored.
	rel, err := s.Store.Relations(r.Context(), u.ID, []int64{target.ID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not resolve relation")
		return
	}
	if !friendRequestAllowed(rel[target.ID]) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
	s.sendPush(r.Context(), target.ID, push.PushPayload{
		Title: "anoon",
		Body:  store.FormatHashID(u.HashID) + " sent you a friend request",
		Tag:   "friend_request",
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// friendRequestAllowed reports whether a friend request may actually be
// delivered, given the sender's relation to the target. A block stops it: the
// request would otherwise reach the person who blocked the sender as a WS event
// and a push, which is the contact they blocked to stop.
//
// store.Relations reports a block in EITHER direction as RelationBlocked (see
// applyRelationRow's doc for why that is deliberate and leaks nothing), so this
// also declines a request to someone the SENDER blocked. That is the wanted
// behaviour and not merely a side effect: offering to befriend someone you have
// blacklisted is incoherent, and every other gate in this codebase treats
// blocking as symmetric — BlockedUserIDs excludes the pair from matchmaking
// regardless of who blocked whom.
func friendRequestAllowed(rel store.Relation) bool {
	return rel != store.RelationBlocked
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
		s.sendPush(r.Context(), from.ID, push.PushPayload{
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

// friendSearchItem is one entry in GET /friends/search. It mirrors
// FriendSearchResult in frontend/src/types/companion.ts, where all four fields
// are REQUIRED — this struct exists so they cannot be omitted by accident again
// (relation and avatarTone previously went unsent, and the search card offered
// «Добавить» to people who were already friends).
type friendSearchItem struct {
	HashID      string `json:"hashId"`
	DisplayName string `json:"displayName"`
	AvatarTone  int    `json:"avatarTone"`
	Relation    string `json:"relation"`
}

// avatarTone reproduces the frontend's `toneFor` so a given person renders in
// the same colour on the search card as in Contacts.
//
// The friends list does NOT get its tone from GET /friends (that endpoint sends
// none): it is built from the Tinode `me` topic's contacts, and
// contactToFriend in frontend/src/store/slices.ts sets
// `avatarTone: toneFor(c.topic)` — keyed on the p2p TOPIC, which is the peer's
// uid. So the key here must be the peer's tinode_uid (stored with its "usr"
// prefix, exactly the topic string), not their #ID.
//
// toneFor sums JS charCodeAt values, i.e. UTF-16 code units. Tinode uids are
// base64url ASCII, so summing bytes is identical for every input this can see.
func avatarTone(key string) int {
	sum := 0
	for i := 0; i < len(key); i++ {
		sum += int(key[i])
	}
	return sum % 6
}

// handleFriendSearch resolves a #ID query to a single user (search is by exact
// #ID only — there are no nicknames).
//
// Searching your own #ID returns you, with relation "self" — deliberately a
// result rather than an empty list, because an empty list reads as "no such
// user" about an id that plainly exists. The client renders that card without a
// «Добавить» button; previously the button was offered and the request then
// failed server-side with self_request.
func (s *Server) handleFriendSearch(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	n, err := parseHashID(r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []friendSearchItem{}})
		return
	}
	target, err := s.Store.UserByHashID(r.Context(), n)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []friendSearchItem{}})
		return
	}

	// One Relations call for the whole result set, not one per result — search
	// returns a single exact match today, but this is the shape that keeps it
	// from becoming an N+1 if it ever widens beyond exact-#ID lookup. It also
	// resolves the caller-is-the-target case to RelationSelf for us.
	rels, err := s.Store.Relations(r.Context(), u.ID, []int64{target.ID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not resolve relation")
		return
	}
	rel, ok := rels[target.ID]
	if !ok {
		rel = store.RelationNone // unreachable: target.ID is always in the query
	}

	writeJSON(w, http.StatusOK, map[string]any{"results": []friendSearchItem{{
		HashID:      store.FormatHashID(target.HashID),
		DisplayName: store.FormatHashID(target.HashID),
		AvatarTone:  avatarTone(target.TinodeUID),
		Relation:    string(rel),
	}}})
}

// parseHashID parses "#00042", "00042", or "42" into the numeric #ID.
func parseHashID(s string) (int64, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "#")
	return strconv.ParseInt(s, 10, 64)
}
