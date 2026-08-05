package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"anoon/companion/internal/matchmaker"
	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
)

// enqueueRequest is the body of POST /roulette/enqueue.
type enqueueRequest struct {
	OwnAgeRange   string   `json:"ownAgeRange"`
	PeerAgeRanges []string `json:"peerAgeRanges"`
}

// handleEnqueue validates the request, builds a queue entry (gender auto-opposite
// is applied by the matcher; own age required), seeds the recent-peer exclude
// set, and enqueues the caller. The actual pairing happens in the match loop.
func (s *Server) handleEnqueue(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req enqueueRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if !matchmaker.ValidAgeRanges[req.OwnAgeRange] {
		writeError(w, http.StatusBadRequest, "invalid_age_range", "ownAgeRange is required and must be a valid bucket")
		return
	}
	for _, r := range req.PeerAgeRanges {
		if !matchmaker.ValidAgeRanges[r] {
			writeError(w, http.StatusBadRequest, "invalid_age_range", "peerAgeRanges contains an unknown bucket")
			return
		}
	}
	if u.Gender != matchmaker.Male && u.Gender != matchmaker.Female {
		writeError(w, http.StatusBadRequest, "invalid_gender", "account has no valid gender")
		return
	}

	ctx := r.Context()
	// Moderation gate: a banned or currently-muted user may not enter the queue.
	banned, muted, err := s.Store.ModerationStatus(ctx, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "moderation lookup failed")
		return
	}
	if banned {
		writeError(w, http.StatusForbidden, "banned", "account is suspended")
		return
	}
	if muted {
		writeError(w, http.StatusForbidden, "muted", "account is temporarily muted")
		return
	}

	// The caller is (re-)entering the queue, so any prior anon chat they left
	// without calling /roulette/end is stale — close it out now. Otherwise the
	// row lingers as 'active' forever and permanently occupies both users'
	// recent-partner exclude set below.
	if err := s.Store.EndActiveMatchesForUser(ctx, u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not end stale matches")
		return
	}

	priority, err := s.Store.Priority(ctx, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "priority lookup failed")
		return
	}
	// A non-positive window disables the recent-partner exclusion entirely
	// (useful for testing with only a couple of accounts), so skip the lookup.
	exclude := make(map[int64]bool)
	if s.RecentMatchWindow > 0 {
		exclude, err = s.Store.RecentPartnerIDs(ctx, u.ID, time.Now().Add(-s.RecentMatchWindow))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "exclude lookup failed")
			return
		}
	}
	// Anti-abuse: never re-match anyone the caller has blocked (or who blocked
	// the caller). Merge the blocked set into the recent-partner exclude set.
	blocked, err := s.Store.BlockedUserIDs(ctx, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "block lookup failed")
		return
	}
	for id := range blocked {
		exclude[id] = true
	}

	entry := &matchmaker.Entry{
		UserID:        u.ID,
		HashID:        u.HashID,
		Gender:        u.Gender,
		AgeRange:      req.OwnAgeRange,
		PeerAgeRanges: req.PeerAgeRanges,
		Priority:      priority,
		EnqueuedAt:    time.Now(),
		Exclude:       exclude,
	}
	// Re-enqueue is idempotent from the client's view: replace any stale entry.
	s.Matcher.Cancel(u.ID)
	if err := s.Matcher.Enqueue(entry); err != nil {
		writeError(w, http.StatusConflict, "already_queued", err.Error())
		return
	}
	s.nudgeMatch()
	writeJSON(w, http.StatusOK, map[string]any{"queued": true})
}

// handleCancel removes the caller from the roulette queue.
func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	s.Matcher.Cancel(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// rouletteStatusResponse is the body of GET /roulette/status. Match mirrors the
// `matched` WS event byte for byte (same struct), so a client can feed either
// delivery path into one handler.
type rouletteStatusResponse struct {
	// Queued reports whether the caller is still waiting in the matcher.
	Queued bool `json:"queued"`
	// Match is the caller's live anon chat, or null when they are not in one.
	Match *matchedEvent `json:"match"`
}

// handleRouletteStatus reports the caller's authoritative roulette state:
// whether they are still queued and, if a pairing already happened, the match
// itself in exactly the shape of the `matched` event.
//
// This is the self-heal path for a dropped `matched` frame. Hub.Send is
// best-effort — a full socket send buffer drops the event, and a socket that is
// mid-reconnect (or a frontend that has not attached its listener yet) never
// sees it at all — which left the client spinning on "searching" forever with a
// perfectly good match sitting in the DB. The searching UI polls this while it
// waits and drives the same transition the event would have.
//
// Read-only and idempotent: it never enqueues, matches, or mutates anything.
func (s *Server) handleRouletteStatus(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	resp := rouletteStatusResponse{Queued: s.Matcher.Contains(u.ID)}

	m, err := s.Store.ActiveMatchForUser(ctx, u.ID)
	switch {
	case errors.Is(err, store.ErrNoMatch):
		// Not paired — Queued alone answers the caller.
	case err != nil:
		writeError(w, http.StatusInternalServerError, "store_failed", "match lookup failed")
		return
	default:
		peer, err := s.Store.UserByID(ctx, m.Peer(u.ID))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "peer lookup failed")
			return
		}
		ev := matchedEvent{
			Type:       "matched",
			Topic:      m.Topic,
			PeerHashID: store.FormatHashID(peer.HashID),
		}
		// The bucket the peer enqueued with lives only in the in-memory queue
		// entry, which is gone by now; reconstruct it from their profile age.
		// Absent age → empty string (the field is display-only on the client).
		if peer.Age != nil {
			ev.PeerAgeRange = matchmaker.BucketForAge(*peer.Age)
		}
		resp.Match = &ev
	}
	writeJSON(w, http.StatusOK, resp)
}

// topicRequest is the shared body for endpoints acting on an anon topic.
type topicRequest struct {
	Topic  string `json:"topic"`
	Rating int    `json:"rating,omitempty"`
	Accept bool   `json:"accept,omitempty"`
}

// handleEnd ends an anonymous chat (either side may call it).
func (s *Server) handleEnd(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req topicRequest
	if !decodeTopic(w, r, &req) {
		return
	}
	m, err := s.Store.MatchByTopic(r.Context(), req.Topic)
	if err != nil || !m.Has(u.ID) {
		writeError(w, http.StatusNotFound, "no_match", "no such match")
		return
	}
	if err := s.Store.EndMatch(r.Context(), req.Topic); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not end match")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleRate stores a 1..5 rating for the caller's peer in the given chat.
func (s *Server) handleRate(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req topicRequest
	if !decodeTopic(w, r, &req) {
		return
	}
	if req.Rating < 1 || req.Rating > 5 {
		writeError(w, http.StatusBadRequest, "invalid_rating", "rating must be 1..5")
		return
	}
	m, err := s.Store.MatchByTopic(r.Context(), req.Topic)
	if err != nil || !m.Has(u.ID) {
		writeError(w, http.StatusNotFound, "no_match", "no such match")
		return
	}
	if err := s.Store.AddRating(r.Context(), m.Peer(u.ID), req.Rating); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save rating")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleReveal records a reveal request from the caller and notifies the peer.
func (s *Server) handleReveal(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req topicRequest
	if !decodeTopic(w, r, &req) {
		return
	}
	m, err := s.Store.RequestReveal(r.Context(), req.Topic, u.ID)
	if err != nil {
		writeError(w, http.StatusConflict, "reveal_failed", err.Error())
		return
	}
	s.Hub.Send(m.Peer(u.ID), revealRequestEvent{
		Type:       "reveal_request",
		Topic:      req.Topic,
		FromHashID: store.FormatHashID(u.HashID),
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleRevealRespond completes (or declines) a reveal. On mutual accept it
// lifts the anon flag (chat becomes a friend chat), marks the pair friends, and
// emits `revealed` to both with real identities.
func (s *Server) handleRevealRespond(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req topicRequest
	if !decodeTopic(w, r, &req) {
		return
	}
	ctx := r.Context()
	if !req.Accept {
		// Decline: leave the match anonymous; peer may ask again later.
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	m, err := s.Store.AcceptReveal(ctx, req.Topic, u.ID)
	if err != nil {
		writeError(w, http.StatusConflict, "reveal_failed", err.Error())
		return
	}
	// Resolve both members' Tinode UIDs — Reveal needs them to grant the presence
	// (P) bit that anon topics withhold, so the now-friends receive each other's
	// presence + message delete/edit broadcasts (BUG-4).
	a, errA := s.Store.UserByID(ctx, m.UserA)
	b, errB := s.Store.UserByID(ctx, m.UserB)
	if errA != nil || errB != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not resolve members")
		return
	}
	// Lift the server-side anon flag (history stays, identities now flow) and
	// grant presence to both members.
	if err := s.Tinode.Reveal(ctx, req.Topic, a.TinodeUID, b.TinodeUID); err != nil {
		writeError(w, http.StatusBadGateway, "tinode_failed", err.Error())
		return
	}
	if err := s.Store.MarkFriends(ctx, m.UserA, m.UserB, "reveal"); err != nil {
		log.Printf("roulette: mark friends after reveal: %v", err)
	}
	s.emitRevealed(ctx, m)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// emitRevealed sends each member the other's real #ID/display name.
func (s *Server) emitRevealed(ctx context.Context, m store.Match) {
	a, errA := s.Store.UserByID(ctx, m.UserA)
	b, errB := s.Store.UserByID(ctx, m.UserB)
	if errA != nil || errB != nil {
		log.Printf("roulette: emitRevealed lookup: %v / %v", errA, errB)
		return
	}
	s.Hub.Send(a.ID, revealedEvent{
		Type: "revealed", Topic: m.Topic,
		PeerHashID: store.FormatHashID(b.HashID), PeerDisplayName: store.FormatHashID(b.HashID),
	})
	s.Hub.Send(b.ID, revealedEvent{
		Type: "revealed", Topic: m.Topic,
		PeerHashID: store.FormatHashID(a.HashID), PeerDisplayName: store.FormatHashID(a.HashID),
	})
}

// --- match loop ------------------------------------------------------------

// RunMatchLoop drains the matcher on a ticker (and on enqueue nudges) until ctx
// is cancelled, turning each produced pair into a live anon topic + events.
func (s *Server) RunMatchLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.matchNudge:
		}
		for {
			match, ok := s.Matcher.TryMatch(time.Now())
			if !ok {
				break
			}
			s.onMatch(ctx, match)
		}
	}
}

// nudgeMatch asks the loop to run a matching pass now (non-blocking).
func (s *Server) nudgeMatch() {
	select {
	case s.matchNudge <- struct{}{}:
	default:
	}
}

// onMatch turns a produced pair into a real anonymous Tinode topic and notifies
// both users. On a Tinode failure the pair is re-queued so they are not lost.
func (s *Server) onMatch(ctx context.Context, m matchmaker.Match) {
	a, errA := s.Store.UserByID(ctx, m.A.UserID)
	b, errB := s.Store.UserByID(ctx, m.B.UserID)
	if errA != nil || errB != nil {
		log.Printf("roulette: onMatch user lookup: %v / %v", errA, errB)
		return
	}

	topic, err := s.Tinode.CreateAnonTopic(ctx, a.TinodeUID, b.TinodeUID)
	if err != nil {
		log.Printf("roulette: create anon topic failed, re-queuing pair: %v", err)
		s.requeue(m.A)
		s.requeue(m.B)
		return
	}
	if _, err := s.Store.CreateMatch(ctx, topic, a.ID, b.ID); err != nil {
		log.Printf("roulette: persist match failed: %v", err)
		// Topic exists but is unrecorded; end/reveal won't find it. Best-effort.
	}
	// Keep the ROOT bot subscribed to this topic so it observes the pair's chat
	// {data} and can push to whichever side is offline (#112). Survives reconnects
	// via the client's watched-topic re-subscribe.
	s.Tinode.WatchTopic(topic)

	s.Hub.Send(a.ID, matchedEvent{
		Type: "matched", Topic: topic,
		PeerHashID: store.FormatHashID(b.HashID), PeerAgeRange: m.B.AgeRange,
	})
	s.Hub.Send(b.ID, matchedEvent{
		Type: "matched", Topic: topic,
		PeerHashID: store.FormatHashID(a.HashID), PeerAgeRange: m.A.AgeRange,
	})
	matchPush := push.PushPayload{Title: "anoon", Body: "You've been matched! Say hi.", Tag: "roulette_match"}
	s.Push.SendPush(ctx, a.ID, matchPush)
	s.Push.SendPush(ctx, b.ID, matchPush)
	log.Printf("roulette: matched #%05d <-> #%05d on %s", a.HashID, b.HashID, topic)
}

// requeue puts an entry back with a fresh timestamp (best-effort).
func (s *Server) requeue(e *matchmaker.Entry) {
	e.EnqueuedAt = time.Now()
	_ = s.Matcher.Enqueue(e)
}

// decodeTopic decodes a topicRequest and validates topic presence. It writes an
// error response and returns false when the body is unusable.
func decodeTopic(w http.ResponseWriter, r *http.Request, req *topicRequest) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return false
	}
	if req.Topic == "" {
		writeError(w, http.StatusBadRequest, "missing_topic", "topic is required")
		return false
	}
	return true
}
