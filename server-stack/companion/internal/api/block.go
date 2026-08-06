package api

import (
	"encoding/json"
	"net/http"
	"time"

	"anoon/companion/internal/store"
)

// blockRequest is the body of POST /roulette/block and POST /friends/block.
//
// Topic is the anon roulette path and takes precedence: during the anon phase
// the caller does not know — and must not learn (H2) — the peer's real #ID, so
// the target is resolved from the match instead. HashID is the #ID path, used by
// the Settings blacklist and by a revealed/friend chat, where the #ID is public
// to the caller anyway.
type blockRequest struct {
	HashID string `json:"hashId"`
	Topic  string `json:"topic"`
}

// handleBlock records that the caller has blocked the peer of a roulette chat.
// The block is persisted as a friendships row with status='blocked' (blocker ->
// blocked) and is honoured by matchmaking: BlockedUserIDs feeds handleEnqueue's
// Exclude set so the two are never re-paired. Idempotent; self-block is refused.
//
// The caller identifies the peer by `topic` (anon phase — membership in the
// match is the authorization) or by `hashId` (after a reveal).
func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req blockRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}

	ctx := r.Context()
	var targetID int64
	switch {
	case req.Topic != "":
		m, err := s.Store.MatchByTopic(ctx, req.Topic)
		if err != nil || !m.Has(u.ID) {
			// Unknown topic, or the caller isn't in that chat — the same
			// anti-spoof rule the relay and reveal paths use.
			writeError(w, http.StatusNotFound, "no_match", "no such match")
			return
		}
		targetID = m.Peer(u.ID)
	case req.HashID != "":
		n, err := parseHashID(req.HashID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_hash_id", "hashId must be a #ID")
			return
		}
		target, err := s.Store.UserByHashID(ctx, n)
		if err != nil {
			writeError(w, http.StatusNotFound, "user_not_found", "no user with that #ID")
			return
		}
		targetID = target.ID
	default:
		writeError(w, http.StatusBadRequest, "missing_target", "topic or hashId is required")
		return
	}

	if targetID == u.ID {
		writeError(w, http.StatusBadRequest, "self_block", "cannot block yourself")
		return
	}
	if err := s.Store.BlockUser(ctx, u.ID, targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not block user")
		return
	}
	// Drop the blocked peer from the live queue match immediately is not needed:
	// the exclude set is rebuilt on the next enqueue. Return success.
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- Settings blacklist (#111) ----------------------------------------------
// GET /friends/blocks / POST /friends/block / DELETE /friends/block/{hashId}
// share the same 'blocked' friendships rows as /roulette/block above, so the
// Settings blacklist and the in-chat "block this peer" action are one and the
// same list — and a block from either place feeds handleEnqueue's Exclude set
// (BlockedUserIDs) so the pair is never re-matched.

// blockEntry is one row in GET /friends/blocks. Field names are frozen (the
// Settings blacklist screen decodes these exactly).
type blockEntry struct {
	HashID      string `json:"hashId"`
	DisplayName string `json:"displayName"`
	BlockedAt   string `json:"blockedAt"`
}

// handleFriendBlocksList returns everyone the caller has blocked.
func (s *Server) handleFriendBlocksList(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rows, err := s.Store.BlockedList(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not load blocks")
		return
	}
	out := make([]blockEntry, 0, len(rows))
	for _, b := range rows {
		out = append(out, blockEntry{
			HashID:      store.FormatHashID(b.HashID),
			DisplayName: store.FormatHashID(b.HashID), // no nicknames: #ID is the name
			BlockedAt:   b.BlockedAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocks": out})
}

// handleFriendBlock adds the #ID in the body to the caller's blacklist. Shares
// the store.BlockUser path with /roulette/block, so the block also excludes the
// pair from matchmaking. Idempotent; self-block is refused.
func (s *Server) handleFriendBlock(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req blockRequest
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
		writeError(w, http.StatusBadRequest, "self_block", "cannot block yourself")
		return
	}
	if err := s.Store.BlockUser(r.Context(), u.ID, target.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not block user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleFriendUnblock removes the {hashId} path segment from the caller's
// blacklist. Idempotent: unblocking someone not blocked still returns 200.
func (s *Server) handleFriendUnblock(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	n, err := parseHashID(r.PathValue("hashId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hash_id", "hashId must be a #ID")
		return
	}
	target, err := s.Store.UserByHashID(r.Context(), n)
	if err != nil {
		writeError(w, http.StatusNotFound, "user_not_found", "no user with that #ID")
		return
	}
	if err := s.Store.UnblockUser(r.Context(), u.ID, target.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not unblock user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
