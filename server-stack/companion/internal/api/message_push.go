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
// and cannot attach to it by name. Pushing for those would require either
// subscribing ROOT to each p2p (resolving its internal p2pXXX name via a ROOT
// {get sub} on one member) or having the frontend notify companion on send —
// both are out of scope here and left as documented follow-ups. Push toggling is
// implicit: a user with no push subscription simply receives nothing (SendPush
// is a no-op), which is exactly what unsubscribing in Settings produces.

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

	s.Push.SendPush(ctx, recipientID, push.PushPayload{
		Title: "anoon",
		Body:  store.FormatHashID(sender.HashID) + ": " + messagePreview(ev.Content),
		Tag:   "msg:" + ev.Topic, // per-topic tag: newer messages replace older
	})
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
