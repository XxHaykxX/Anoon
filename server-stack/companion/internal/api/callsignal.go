package api

import (
	"context"
	"encoding/json"
	"strings"

	"anoon/companion/internal/store"
)

// callSignalTypes are the WebRTC signaling frame types relayed unchanged
// (plus a "from" = sender hashId) from one authenticated user's /ws socket to
// their peer's. Every other frame type is ignored — the WS read loop is
// otherwise receive-only, so this is the one place inbound client frames do
// anything:
//
//	{ "type":"call:offer",   "to":"#00012", "callId":"...", "media":"audio"|"video", "sdp":{...} }
//	{ "type":"call:answer",  "to":"#00012", "callId":"...", "sdp":{...} }
//	{ "type":"call:ice",     "to":"#00012", "callId":"...", "candidate":{...} }
//	{ "type":"call:hangup",  "to":"#00012", "callId":"...", "reason":"" }
//
// If the target has no live socket, the sender gets back
// { "type":"call:unavailable", "callId":"..." } instead.
var callSignalTypes = map[string]bool{
	"call:offer":  true,
	"call:answer": true,
	"call:ice":    true,
	"call:hangup": true,
}

// msgDelType is the inbound frame type for a peer-to-peer message-delete relay
// (BUG-4 / #121): Tinode does not deliver {pres what:"del"} to a session that
// attached while the topic was anonymous (its effective mode is fixed for the
// session's lifetime), so a revealed friend's hard-delete never reaches the
// other side natively. The deleter's client instead emits this frame and
// companion relays it to the peer, mirroring the call-signaling path.
const msgDelType = "msg:del"

// peerLeavingType is the inbound frame a client emits when the user deliberately
// leaves a roulette/revealed pair chat (BUG-15). Anon pair topics carry no P
// access bit, so Tinode delivers no presence/leave signal to the other side —
// the remaining user's chat would otherwise never end. Companion relays it to
// the peer as peerLeftType so their UI can inject a "собеседник покинул чат"
// system line and mark the chat ended. Same resolve→peer + anti-spoof path as
// the call-signaling and msg:del relays.
const peerLeavingType = "peer:leaving"

// peerLeftType is the outbound frame companion sends to the remaining peer.
const peerLeftType = "peer:left"

// activityType is an ephemeral "peer is doing X" hint (BUG-18) — currently
// kind:"media" ("отправляет медиа"). Typing itself rides Tinode's native kp
// note; this covers signals Tinode has no frame for. Relayed to the peer,
// resolved either by an explicit `to` hashId (p2p friend chats, which aren't
// tracked as matches) or by topic→match (anon/revealed pairs). Fire-and-forget:
// if the peer is offline it's simply dropped.
const activityType = "activity"

// handleWSFrame dispatches one inbound WS frame from an authenticated user.
// Malformed or unrecognized frames are silently ignored (robustness over
// strictness — a client bug here must not kill the socket).
func (s *Server) handleWSFrame(ctx context.Context, u store.User, raw []byte) {
	var frame map[string]any
	if err := json.Unmarshal(raw, &frame); err != nil {
		return
	}
	switch typ, _ := frame["type"].(string); {
	case callSignalTypes[typ]:
		s.relayCallSignal(ctx, u, frame)
	case typ == msgDelType:
		s.relayMsgDel(ctx, u, frame)
	case typ == peerLeavingType:
		s.relayPeerLeave(ctx, u, frame)
	case typ == activityType:
		s.relayActivity(ctx, u, frame)
	}
	// Any other frame type is ignored — the socket is otherwise receive-only.
}

// relayActivity forwards an ephemeral activity hint (BUG-18) to the peer.
// Inbound from the actor:
//
//	{ "type":"activity", "kind":"media", "to":"#00012", "topic":"usrXXX" }  // friend chat
//	{ "type":"activity", "kind":"media", "topic":"grpXXX" }                 // anon/revealed
//
// Resolves the peer by `to` (hashId) when present, else by topic→peer (the
// sender must be a member — anti-spoof). Forwards, stamping `from`:
//
//	{ "type":"activity", "kind":"media", "topic":"...", "from":"#00042" }
//
// The outbound topic is the RECIPIENT's name for it: p2p topic names are
// per-user, and the client routes this frame to its open chat by exact topic
// match, so a verbatim usrXXX would be dropped on arrival (see relayTopicPeer).
func (s *Server) relayActivity(ctx context.Context, u store.User, frame map[string]any) {
	kind, _ := frame["kind"].(string)
	if kind == "" {
		return
	}
	topic, _ := frame["topic"].(string)

	var peerID int64
	if to, _ := frame["to"].(string); to != "" {
		target, err := s.resolveHashID(ctx, to)
		if err != nil {
			return
		}
		peerID = target.ID
		if strings.HasPrefix(topic, "usr") && u.TinodeUID != "" {
			topic = u.TinodeUID // p2p: name the topic from the peer's side
		}
	} else if topic != "" {
		var ok bool
		peerID, topic, ok = s.relayTopicPeer(ctx, u, topic)
		if !ok {
			return
		}
	} else {
		return
	}
	if peerID == 0 || !s.Hub.Online(peerID) {
		return // no peer, or peer offline: drop (ephemeral, no catch-up)
	}

	s.Hub.Send(peerID, map[string]any{
		"type":  activityType,
		"topic": topic,
		"kind":  kind,
		"from":  store.FormatHashID(u.HashID),
	})
}

// relayPeerLeave forwards a deliberate "I'm leaving this chat" to the other
// member of a roulette/revealed pair topic (BUG-15). Inbound frame from the
// leaver:
//
//	{ "type":"peer:leaving", "topic":"grpXXX" }
//
// It resolves topic → match → the OTHER member (the sender must be a member, so
// nobody can spoof a leave in a chat they aren't in) and, if that peer has a
// live socket, sends them:
//
//	{ "type":"peer:left", "topic":"grpXXX", "from":"#00042" }
//
// "from" is stamped by companion (not trusted from the client). If the peer is
// offline the signal is dropped — they'll re-derive the chat state on reconnect
// and there's no live chat to inject into. Only grp (roulette/revealed) topics
// resolve as matches; p2p friend chats aren't tracked here (same scope as the
// msg:del relay).
func (s *Server) relayPeerLeave(ctx context.Context, u store.User, frame map[string]any) {
	topic, _ := frame["topic"].(string)
	if topic == "" {
		return
	}

	m, err := s.Store.MatchByTopic(ctx, topic)
	if err != nil || !m.Has(u.ID) {
		return // unknown topic, or sender isn't a member (anti-spoof)
	}
	peerID := m.Peer(u.ID)
	if peerID == 0 || !s.Hub.Online(peerID) {
		return // no peer, or peer offline: drop
	}

	s.Hub.Send(peerID, map[string]any{
		"type":  peerLeftType,
		"topic": topic,
		"from":  store.FormatHashID(u.HashID),
	})
}

// relayMsgDel forwards a message-delete to the other member of the chat
// (BUG-4 / #121). Inbound frame from the deleter:
//
//	{ "type":"msg:del", "topic":"grpXXX"|"usrXXX", "seqs":[<seq>,...] }
//
// It resolves topic → peer via relayTopicPeer (the sender must be a member, so
// nobody can wipe messages in a chat they aren't in) and, if that peer has a
// live socket, sends them:
//
//	{ "type":"msg:del", "topic":<peer's name for the topic>, "seqs":[...], "from":"#00042" }
//
// Both anon/revealed (grp) and p2p friend (usr) chats resolve here. For p2p the
// outbound topic is REWRITTEN into the recipient's perspective — see
// relayTopicPeer for why sending it verbatim silently loses the delete.
//
// "from" is stamped by companion (not trusted from the client), same anti-spoof
// rule as call signaling. If the peer is offline the delete is dropped — a
// reopened chat won't reload a server-deleted message (client cache flush is the
// frontend's half of the fix), so no push is needed.
func (s *Server) relayMsgDel(ctx context.Context, u store.User, frame map[string]any) {
	topic, _ := frame["topic"].(string)
	if topic == "" {
		return
	}
	seqs, ok := frame["seqs"].([]any)
	if !ok || len(seqs) == 0 {
		return // nothing to delete / malformed
	}

	peerID, outTopic, ok := s.relayTopicPeer(ctx, u, topic)
	if !ok || peerID == 0 || !s.Hub.Online(peerID) {
		return // unresolvable, no peer, or peer offline: drop
	}

	s.Hub.Send(peerID, map[string]any{
		"type":  msgDelType,
		"topic": outTopic,
		"seqs":  seqs,
		"from":  store.FormatHashID(u.HashID),
	})
}

// relayTopicPeer resolves the recipient of a topic-addressed relay frame and
// returns the topic name to put on the OUTBOUND frame — which is not always the
// inbound one. Two topic shapes reach us and they resolve differently:
//
//   - grpXXX — a roulette/revealed pair topic. Both members know it by the same
//     name, so the topic goes out unchanged; membership comes from
//     roulette_matches (the sender must be in the match — anti-spoof).
//
//   - usrXXX — a Tinode *p2p* friend topic. p2p topic names are PER-USER: the
//     name each side uses is the OTHER side's uid. The conversation A addresses
//     as `usrB` is the one B knows as `usrA`. Relaying such a frame verbatim
//     hands B a topic string B has never heard of — its client matches the frame
//     against the chat it has open by exact topic name and drops it — so the
//     outbound topic is rewritten to the sender's own uid, i.e. into the
//     recipient's perspective. The peer is simply the user the inbound topic
//     names, and membership is an accepted friendship.
//
// This asymmetry is why «удалить у всех» never reached the peer in a friend chat
// (BUG-4 / #121) while it worked in anon/revealed chats: p2p topics have no
// roulette_matches row at all, so the old MatchByTopic-only resolution dropped
// every p2p frame on the floor before the naming question even came up.
//
// ok=false means "don't relay": unknown topic, sender not a member, or a p2p
// sender whose own uid we don't know (we could not name the topic for the peer).
func (s *Server) relayTopicPeer(ctx context.Context, u store.User, topic string) (peerID int64, outTopic string, ok bool) {
	if strings.HasPrefix(topic, "usr") {
		// tinode_uid is stored WITH the "usr" prefix, so the topic name is the
		// lookup key as-is and u.TinodeUID is already a usable topic name.
		peer, err := s.Store.UserByTinodeUID(ctx, topic)
		if err != nil || peer.ID == u.ID || u.TinodeUID == "" {
			return 0, "", false
		}
		friends, err := s.Store.AreFriends(ctx, u.ID, peer.ID)
		if err != nil || !friends {
			return 0, "", false // not a conversation the sender is part of
		}
		return peer.ID, u.TinodeUID, true
	}

	m, err := s.Store.MatchByTopic(ctx, topic)
	if err != nil || !m.Has(u.ID) {
		return 0, "", false // unknown topic, or sender isn't a member (anti-spoof)
	}
	return m.Peer(u.ID), topic, true
}

// relayCallSignal forwards a call:* frame to its "to" target's socket(s),
// stamping "from" with the sender's hashId. Replies call:unavailable to the
// sender if the target cannot be resolved or has no live socket.
func (s *Server) relayCallSignal(ctx context.Context, u store.User, frame map[string]any) {
	to, _ := frame["to"].(string)
	callID := frame["callId"]

	target, err := s.resolveHashID(ctx, to)
	if err != nil || !s.Hub.Online(target.ID) {
		s.Hub.Send(u.ID, map[string]any{"type": "call:unavailable", "callId": callID})
		return
	}

	// Forwarded unchanged aside from stamping "from" (spec: sender must not be
	// able to spoof another user's identity in the frame the peer receives).
	frame["from"] = store.FormatHashID(u.HashID)
	s.Hub.Send(target.ID, frame)
}

// resolveHashID looks up a user by a "#00012"/"00012"/"12" hashId string.
func (s *Server) resolveHashID(ctx context.Context, hashID string) (store.User, error) {
	n, err := parseHashID(hashID)
	if err != nil {
		return store.User{}, err
	}
	return s.Store.UserByHashID(ctx, n)
}
