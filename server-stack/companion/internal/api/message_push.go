package api

// message_push.go implements offline-recipient push on new chat messages (#112).
//
// The ROOT bot's gRPC MessageLoop streams every chat {data} it can observe into
// s.onTinodeData (wired in NewServer via tinode.Client.SetDataHandler). For each
// message we resolve the topic's two members, and if the recipient (the member
// who is NOT the sender) has no live companion WebSocket — i.e. the app isn't
// open in front of them — we send them a Web Push with the sender's #ID and a
// short preview. If they have a socket, they'll receive the message live over
// Tinode, so we skip the push.
//
// Scope / what ROOT can observe: ROOT owns and stays subscribed to the group
// topics roulette creates (WatchTopic in onMatch), and a revealed match keeps
// using that same grpXXX topic, so both anonymous and revealed-friend chats
// flow through here. Friend chats opened as a Tinode *p2p* topic (friend-by-#ID
// search / invite → CreateP2P) are NOT observed: ROOT is not a member of a p2p
// and cannot attach to it by name.
//
// p2p is therefore covered from the other end (#31): the SENDER's client emits a
// `msg:sent` frame up its own companion socket after a successful p2p publish,
// and onMessageSent below turns that into the push. Of the three ways to close
// this gap, that is the one with no side effects: a Tinode plugin FireHose would
// mean companion running a plugin server that tinode.conf has to point at, and
// subscribing ROOT to the p2p on_behalf_of a member would make Tinode treat that
// member as attached — corrupting their presence ("в сети" while they are away)
// and very likely their delivery receipts. Push toggling is implicit: a user
// with no push subscription simply receives nothing (SendPush is a no-op), which
// is exactly what unsubscribing in Settings produces.

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
	"anoon/companion/internal/tinode"
)

// RewatchActiveTopics re-subscribes the ROOT bot to every currently-active anon
// chat topic once the ROOT session is ready. Called once at startup so a
// companion restart doesn't leave in-flight anon chats without message-push
// until the next match. Best-effort: a failure just means push is degraded for
// those chats until they end, never a crash.
func (s *Server) RewatchActiveTopics(ctx context.Context) {
	if err := s.Tinode.WaitReady(ctx); err != nil {
		return // shutting down before ROOT ever connected
	}
	topics, err := s.Store.ActiveMatchTopics(ctx)
	if err != nil {
		log.Printf("message-push: load active topics for rewatch: %v", err)
		return
	}
	if len(topics) == 0 {
		return
	}
	s.Tinode.Rewatch(topics)
	log.Printf("message-push: re-subscribed ROOT to %d active anon topic(s)", len(topics))
}

// messagePreviewMax caps the body preview length so a long message doesn't
// bloat the notification payload.
const messagePreviewMax = 120

// onTinodeData handles one observed chat {data} message. It is invoked off the
// ROOT read loop in a panic-guarded goroutine (see tinode.Client.dispatchData),
// so it may block on DB/push without stalling the stream; it must still never
// panic on malformed input, hence the defensive early returns throughout.
func (s *Server) onTinodeData(ev tinode.DataEvent) {
	// Only ROOT-owned group topics (anon + revealed matches) reach us with
	// resolvable membership; anything else (p2p, system topics) is ignored.
	if ev.FromUID == "" || !strings.HasPrefix(ev.Topic, "grp") {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	m, err := s.Store.MatchByTopic(ctx, ev.Topic)
	if err != nil {
		return // no known match for this topic — nothing to resolve
	}
	sender, err := s.Store.UserByTinodeUID(ctx, ev.FromUID)
	if err != nil {
		return // sender not a anoon user (or deleted); skip
	}
	recipientID := m.Peer(sender.ID)
	if recipientID == 0 {
		return // sender isn't a member of this match (shouldn't happen)
	}
	// Recipient is looking at the chat right now (live companion socket): they'll
	// get the message over Tinode, so don't also push.
	if s.Hub.Online(recipientID) {
		return
	}
	if !s.senderMayPush(ctx, sender.ID) {
		return
	}

	s.Push.SendPush(ctx, recipientID, push.PushPayload{
		Title: "anoon",
		Body:  messagePushBody(sender, m, ev.Content),
		Tag:   "msg:" + ev.Topic, // per-topic tag: newer messages replace older
	})
}

// msgSentType is the inbound frame a client emits right after it successfully
// publishes a message into a *p2p* friend chat (#31). ROOT cannot observe those
// topics (see the file header), so the sender tells us instead:
//
//	{ "type":"msg:sent", "to":"#00012", "topic":"usrXXX", "preview":"привет" }
//
// It is a push trigger only — it relays nothing to the peer's socket, because a
// peer with a live socket gets the message natively over Tinode.
const msgSentType = "msg:sent"

// onMessageSent pushes to the recipient of a p2p friend-chat message whose
// sender just told us about it. Four things keep this honest:
//
//   - Spoofing: the target is resolved by resolveRelayTarget, so a sender can
//     only ever reach someone they have an accepted friendship or a live match
//     with — the same rule the call/activity relays run under. `from` is stamped
//     server-side from the caller's own row, never taken from the frame.
//   - Double push: anon and revealed pairs are already covered by the ROOT grp
//     path above, so anything that resolves to a live match is dropped here.
//     Belt and braces — the client only emits this from the p2p send path — but
//     the pair can legitimately be both friends and freshly re-matched, and two
//     notifications for one message is exactly the bug that would produce.
//   - Recipient is reading: skipped when they hold a live companion socket, the
//     same proxy for "the app is open in front of them" that the grp path uses.
//     Companion tracks no finer per-chat "currently viewing" signal, so this is
//     as precise as it gets: a push is suppressed while they have the app open
//     on ANY screen, never delivered twice, and never sent to someone reading.
//   - Moderation: a banned or muted sender gets no notification out of this at
//     all — see senderMayPush.
//
// The blacklist needs no clause of its own: a block outranks 'accepted' in
// store.Relations and is symmetric, so AreFriends (and with it
// resolveRelayTarget) already returns false for a pair where either side has
// blocked the other. The push toggle needs none either — turning it off is an
// unsubscribe, and SendPush to a user with no subscription is a no-op.
func (s *Server) onMessageSent(ctx context.Context, u store.User, frame map[string]any) {
	to, _ := frame["to"].(string)
	if to == "" {
		return
	}
	// An alias only ever names a roulette peer, i.e. the grp path's territory.
	if store.NormalizeAlias(to) != "" {
		return
	}
	link, ok := s.resolveRelayTarget(ctx, u, to)
	if !ok || link.peerID == 0 {
		return
	}
	if _, err := s.Store.LiveMatchBetween(ctx, u.ID, link.peerID); err == nil {
		return // live pair: onTinodeData already pushes for it
	}
	if s.Hub.Online(link.peerID) {
		return
	}
	if !s.senderMayPush(ctx, u.ID) {
		return
	}

	preview, _ := frame["preview"].(string)
	body := "New message"
	if p := truncatePreview(preview, messagePreviewMax); p != "" {
		body = p
	}
	s.Push.SendPush(ctx, link.peerID, push.PushPayload{
		Title: "anoon",
		// Named by the caller's own #ID, not the frame: a p2p chat only exists
		// between friends, who already know each other's real #ID, so there is
		// no alias to preserve here (H2 covers anon pairs, handled above).
		Body: store.FormatHashID(u.HashID) + ": " + body,
		// Same per-topic tag shape as the grp path, addressed from the
		// recipient's side (their view of this chat is named by OUR uid), so a
		// burst of messages collapses into one notification instead of stacking.
		Tag: "msg:" + u.TinodeUID,
	})
}

// senderMayPush reports whether a message from this user is still allowed to
// wake somebody else's device. A ban or a live mute takes that away.
//
// Mute is the product's "you don't get to interrupt people" lever — it already
// closes the roulette queue (roulette.go) — and a lock-screen notification is
// the most intrusive thing a muted account can still do. It is NOT a claim that
// the message is suppressed: mute is companion-side only (users.mute_until, not
// a Tinode ACL), so the message itself keeps arriving in the chat. What stops
// here is the interruption, which is the part mute is about.
//
// Ban is belt and braces. A suspended account's Tinode token stops resolving, so
// in production a banned sender cannot authenticate a new socket at all — but a
// socket opened just before the ban lands stays connected, and this closes that
// window without waiting for it to time out.
//
// Called last on both push paths, after the offline and membership checks, so
// the extra lookup is only paid on a message that is genuinely about to push.
// Fail-open on a lookup error: a DB hiccup must silence nobody's notifications.
func (s *Server) senderMayPush(ctx context.Context, senderID int64) bool {
	banned, muted, err := s.Store.ModerationStatus(ctx, senderID)
	if err != nil {
		log.Printf("message-push: moderation lookup for sender %d: %v", senderID, err)
		return true
	}
	return !banned && !muted
}

// messagePushBody renders the notification body for an observed chat message:
// who sent it, then a preview of what they said.
//
// The sender is named by peerFacingHandle, so an anon roulette peer appears as
// their per-match alias. This body lands on a lock screen, and it used to read
// "#00012: привет" mid-anon chat — companion handing over the permanent public
// #ID that the anon phase exists to withhold (H2), through a channel nobody was
// watching. After a mutual reveal the real #ID is correct and appears again.
func messagePushBody(sender store.User, m store.Match, content []byte) string {
	return peerFacingHandle(sender, m) + ": " + messagePreview(content)
}

// messagePreview renders a short, safe body preview from a Tinode message
// payload. Messages arrive as Drafty ({"txt":"...","fmt":[...]}) or, for a plain
// string send, a bare JSON string. Anything else (attachments, structured
// content) falls back to a generic label rather than leaking raw JSON.
func messagePreview(content []byte) string {
	const fallback = "New message"
	if len(content) == 0 {
		return fallback
	}
	var v any
	if err := json.Unmarshal(content, &v); err != nil {
		return fallback
	}
	switch t := v.(type) {
	case string:
		return truncatePreview(t, messagePreviewMax)
	case map[string]any:
		if txt, ok := t["txt"].(string); ok && strings.TrimSpace(txt) != "" {
			return truncatePreview(txt, messagePreviewMax)
		}
	}
	return fallback
}

// truncatePreview trims s to at most n runes, appending an ellipsis when cut.
func truncatePreview(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}
