package api

import (
	"context"
	"database/sql"
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
	// Reveal is where the reveal exchange stands from the CALLER's side —
	// "none" | "we_requested" | "peer_requested" | "declined" | "revealed" —
	// or "" when there is no match. It is a sibling of Match rather than a
	// field on it because matchedEvent is shared byte-for-byte with the
	// `matched` WS frame, which must not grow a field that means nothing at
	// match time.
	//
	// This is the resync half of #23. reveal_request / reveal_declined /
	// revealed are all delivered over a best-effort socket, so an app that is
	// backgrounded at the wrong moment misses the answer with no way to ask
	// again — the same «Ожидание…» dead end the decline event was added to
	// remove, reached by a different route. The client already polls this
	// endpoint while a match is open, so it heals from here with no new call.
	Reveal string `json:"reveal,omitempty"`
	// RevealAsksLeft is how many more times the CALLER may ask in this match
	// (see store.maxRevealDeclines). 0 means the answer stands and a further
	// request would be refused with `reveal_asks_exhausted`. A pointer so the
	// key is absent without a match rather than reading as "exhausted", which
	// is what a plain 0 would say.
	RevealAsksLeft *int `json:"revealAsksLeft,omitempty"`
	// PeerHashID / PeerDisplayName are the peer's REAL identity, and are sent
	// only when Reveal == "revealed". Everything else about an anon match is
	// deliberately identity-free (H2), so these two fields are the single
	// exception and they are gated on the state, never on the match merely
	// existing — see revealedIdentity.
	//
	// They are here because a missed `revealed` frame was otherwise unhealable:
	// identity arrives only in that frame, so a client polling after missing it
	// learned the handshake had completed with nothing to render or to promote
	// into the friends list. At "revealed" both sides have consented and these
	// values are no longer secret, which is the entire meaning of that state.
	PeerHashID      string `json:"peerHashId,omitempty"`
	PeerDisplayName string `json:"peerDisplayName,omitempty"`
}

// revealedIdentity returns the peer's real #ID and display name, but only once
// the reveal is mutual. Split out from the handler so the gate is one testable
// expression: this is the only place in the roulette surface that turns an anon
// peer into a named account, and "it is guarded, trust me" is not something to
// leave spread across a handler.
func revealedIdentity(state string, peer store.User) (hashID, displayName string) {
	if state != store.RevealDone {
		return "", ""
	}
	// Same rendering emitRevealed uses, so the poll and the frame name the peer
	// identically — there are no nicknames, the #ID is the display name.
	id := store.FormatHashID(peer.HashID)
	return id, id
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

	m, err := s.Store.CurrentMatchForUser(ctx, u.ID)
	switch {
	case errors.Is(err, store.ErrNoMatch):
		// Not paired — Queued alone answers the caller.
	case err != nil:
		writeError(w, http.StatusInternalServerError, "store_failed", "match lookup failed")
		return
	default:
		// A peer who deleted their account is not someone to resync a chat
		// with. DeleteUser ends their active matches, so this should already
		// have been ErrNoMatch above — asking for a LIVE user makes the answer
		// not depend on that ordering holding, and degrades to "no match"
		// rather than a 500 if it ever stops.
		peer, err := s.Store.LiveUserByID(ctx, m.Peer(u.ID))
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "peer lookup failed")
			return
		}
		// The bucket the peer enqueued with lives only in the in-memory queue
		// entry, which is gone by now; reconstruct it from their profile age.
		// Absent age → empty string (the field is display-only on the client).
		var ageRange string
		if peer.Age != nil {
			ageRange = matchmaker.BucketForAge(*peer.Age)
		}
		ev := anonMatchedEvent(m, u.ID, ageRange)
		resp.Match = &ev
		resp.Reveal = m.RevealStateFor(u.ID)
		left := m.RevealAsksLeft(u.ID)
		resp.RevealAsksLeft = &left
		resp.PeerHashID, resp.PeerDisplayName = revealedIdentity(resp.Reveal, peer)
	}
	writeJSON(w, http.StatusOK, resp)
}

// anonMatchedEvent builds the `matched` payload as viewerID should see it: the
// peer is named by their per-match alias, never by the real #ID that /me returns
// and /friends/search resolves (H2).
//
// Both delivery paths go through here — the WS event at match time and the
// GET /roulette/status resync — because they must not drift. A client that
// missed the frame and polls instead has to be told the same peer handle, or the
// recovery path hands it a peer it has never heard of and the anon chat opens
// against a stranger's handle.
func anonMatchedEvent(m store.Match, viewerID int64, peerAgeRange string) matchedEvent {
	return matchedEvent{
		Type:         "matched",
		Topic:        m.Topic,
		PeerAlias:    m.PeerAlias(viewerID),
		PeerAgeRange: peerAgeRange,
	}
}

// peerFacingHandle is the single answer to "what may u's peer see u as, in this
// pairing": u's per-match alias while the match is still anonymous, u's real #ID
// once revealed (or when there is no match at all, i.e. a p2p friend chat).
//
// Every path that names one member of a match TO the other goes through here —
// the relay frames companion stamps (`call:*`, `msg:del`, `peer:left`,
// `activity`) and the message push body. All of them used to call FormatHashID
// unconditionally, which handed over the peer's permanent public #ID mid-anon
// chat through a channel H2 never looked at.
func peerFacingHandle(u store.User, m store.Match) string {
	if m.Anon() {
		if alias := m.AliasFor(u.ID); alias != "" {
			return alias
		}
	}
	return store.FormatHashID(u.HashID)
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
	// Keyed by (match, rater), so re-sending this revises the caller's one vote
	// instead of adding another. Membership above says "you were in this chat",
	// which is not the same as "you may score this person again" — the endpoint
	// used to accept the difference as an unbounded increment (S3).
	if err := s.Store.RateMatch(r.Context(), m.ID, u.ID, m.Peer(u.ID), req.Rating); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save rating")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleReveal records a reveal request from the caller and notifies the peer.
//
// Rate-limited at the router (see there). What that bounds is a fast loop; what
// it does not bound is patient nagging — a re-ask every few minutes stays under
// any per-second budget. Closing that properly means a per-match decline count
// or cooldown, which is a product decision (how many times may someone ask
// before the answer is taken as final?) and is deliberately not invented here.
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
	if errors.Is(err, store.ErrRevealAsksExhausted) {
		// Distinct from a generic failure so the client can say "you have asked
		// twice and been declined" rather than offering a retry that will never
		// work. The peer is told nothing: they already answered.
		writeError(w, http.StatusConflict, "reveal_asks_exhausted",
			"you have already asked twice in this chat and been declined")
		return
	}
	if err != nil {
		writeError(w, http.StatusConflict, "reveal_failed", err.Error())
		return
	}
	// The peer may still decline, so the asker is named by their per-match alias.
	// Sending the real #ID here would have handed over the identity on a request
	// alone — a one-sided reveal (H2).
	s.Hub.Send(m.Peer(u.ID), revealRequestEvent{
		Type:      "reveal_request",
		Topic:     req.Topic,
		FromAlias: m.AliasFor(u.ID),
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
		// Decline: the match stays anonymous, the pending request is cleared so
		// either side may ask again, and the requester is told — otherwise their
		// button sits on «Ожидание…» until the chat ends, because nothing on the
		// wire ever said no.
		//
		// This path used to return 200 without touching the store, so it also
		// never checked membership; now that it emits an event, it must, or a
		// stranger could post a decline for any topic and fake the frame.
		requester, err := s.Store.DeclineReveal(ctx, req.Topic, u.ID)
		if err != nil {
			writeError(w, http.StatusNotFound, "no_match", "no such match")
			return
		}
		if requester != 0 {
			s.Hub.Send(requester, revealDeclinedEvent{
				Type:  "reveal_declined",
				Topic: req.Topic,
			})
		}
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
	// presence + message delete/edit broadcasts (BUG-4). Live lookups: there is
	// nobody to reveal yourself to once the other side has deleted their account.
	a, errA := s.Store.LiveUserByID(ctx, m.UserA)
	b, errB := s.Store.LiveUserByID(ctx, m.UserB)
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
	// Live lookups: a revealed identity must not be handed to, or built from, an
	// account that no longer exists.
	a, errA := s.Store.LiveUserByID(ctx, m.UserA)
	b, errB := s.Store.LiveUserByID(ctx, m.UserB)
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
	// Live lookups. handleDeleteMe evicts the caller from the matcher, so a
	// deleted account should never reach here — but the queue is in memory and
	// the delete is a database write, so the two can cross. Pairing someone with
	// an account that no longer exists would open a chat with nobody in it.
	a, errA := s.Store.LiveUserByID(ctx, m.A.UserID)
	b, errB := s.Store.LiveUserByID(ctx, m.B.UserID)
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
	// The match row also mints the pair's anon aliases, so a failure here is no
	// longer merely "end/reveal won't find it": there is no anonymous handle to
	// name the peers by, and the only other handle we hold is the real #ID that
	// must not go out (H2). Re-queue instead of opening a chat we cannot describe.
	//
	// The topic already exists with both members subscribed, and nobody is about
	// to be told about it, so tear it back down — an un-recorded topic is
	// unreachable by every cleanup path companion has (they all start from
	// roulette_matches) and would sit in two contact lists as a dead chat.
	match, err := s.Store.CreateMatch(ctx, topic, a.ID, b.ID)
	if err != nil {
		log.Printf("roulette: persist match failed, re-queuing pair: %v", err)
		if delErr := s.Tinode.DeleteTopic(ctx, topic); delErr != nil {
			// Nothing left to try: it is not in the DB either, so this one is
			// logged loudly for manual reconciliation rather than swallowed.
			log.Printf("roulette: ORPHAN TOPIC %s — created but neither persisted nor deleted: %v", topic, delErr)
		}
		s.requeue(m.A)
		s.requeue(m.B)
		return
	}
	// Keep the ROOT bot subscribed to this topic so it observes the pair's chat
	// {data} and can push to whichever side is offline (#112). Survives reconnects
	// via the client's watched-topic re-subscribe.
	s.Tinode.WatchTopic(topic)

	// Each side learns the other's per-match alias, never their #ID (H2).
	s.Hub.Send(a.ID, anonMatchedEvent(match, a.ID, m.B.AgeRange))
	s.Hub.Send(b.ID, anonMatchedEvent(match, b.ID, m.A.AgeRange))
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
