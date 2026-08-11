package api

// chats.go serves the admin "Чаты" section (COMPANION-ADMIN-API.md §3): the list
// of conversations, and one conversation read whole.
//
// Q7a — whether a moderator sees the whole conversation or only the messages a
// report names — was decided by the owner on 2026-08-11: the whole thing. That
// is the only reason this endpoint did not exist; nothing about it is
// provisional now.
//
// It is the one admin section whose data is not companion's: the messages live
// in Tinode topics and are read by the ROOT bot (internal/tinode/chats.go).
// companion supplies who the two people behind a topic are and which of their
// attachments are still live. Access is gated exactly like every other /admin/*
// route — s.adminOnly, the shared secret plus the operator identity — and every
// open is written to moderator_actions.

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"anoon/companion/internal/store"
	"anoon/companion/internal/tinode"
)

const (
	// chatLiveWindow: a conversation counts as "идёт сейчас" while its last
	// message is this recent. Computed here rather than in the panel so the
	// contract is identical whichever backend answers.
	chatLiveWindow = 5 * time.Minute
	// chatListLimit / chatMessageLimit bound one read of the section.
	chatListLimit    = 200
	chatMessageLimit = 500
	// chatViewThrottle bounds how often opening one conversation writes a
	// journal entry. The panel re-reads an open chat every 5 seconds, so without
	// this the audit journal would fill with one row per poll per open tab and
	// the record of who read what would be unreadable — which is the same as not
	// having it. One entry per operator per conversation per window is the fact
	// worth keeping.
	chatViewThrottle = 10 * time.Minute
)

// chatPeer is one participant as the panel renders them.
type chatPeer struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	PublicID string `json:"publicId"`
	Emoji    string `json:"emoji"`
}

// chatConversation is one row of the conversation list. LastMessageAt is null
// for a topic that never carried a message.
type chatConversation struct {
	ID            string     `json:"id"`
	A             chatPeer   `json:"a"`
	B             chatPeer   `json:"b"`
	Messages      int        `json:"messages"`
	LastMessageAt *time.Time `json:"lastMessageAt"`
	CreatedAt     time.Time  `json:"createdAt"`
	Live          bool       `json:"live"`
}

// chatMessage is one message in the viewer. SenderID is EMPTY while the pair is
// still anonymous — Tinode blanks the sender on an anon topic for every reader,
// ROOT included (see tinode.Message).
type chatMessage struct {
	ID        string    `json:"id"`
	SenderID  string    `json:"senderId"`
	Kind      string    `json:"kind"`
	Text      *string   `json:"text"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	MediaURL  *string   `json:"mediaUrl"`
	MediaKind *string   `json:"mediaKind"`
}

// handleAdminChats serves both shapes the panel calls (chats/page.tsx):
// GET /admin/chats lists conversations, GET /admin/chats?id=<topic> reads one.
func (s *Server) handleAdminChats(w http.ResponseWriter, r *http.Request) {
	if topic := strings.TrimSpace(r.URL.Query().Get("id")); topic != "" {
		s.adminChatMessages(w, r, topic)
		return
	}
	s.adminChatList(w, r)
}

func (s *Server) adminChatList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := s.Store.ListChats(ctx, chatListLimit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not list conversations")
		return
	}

	// Message counts and last activity only exist in Tinode. A ROOT-stream blip
	// must not blank the section: the operator still gets the conversations and
	// can open them, just without the counters.
	//
	// The read is bounded by WHEN, not by how many: ask for every topic ROOT is
	// in that was touched since the oldest pairing on this page. The pairings
	// come newest-first, so that window covers all of them — and a count is
	// asked for by activity rather than by an arbitrary slice of ROOT's
	// subscriptions, which is all a limit buys here (see tinode.Topics).
	stats := map[string]tinode.TopicInfo{}
	infos, err := s.Tinode.Topics(ctx, oldestChat(rows))
	if err != nil {
		log.Printf("admin: chat topics from ROOT: %v", err)
	}
	for _, info := range infos {
		stats[info.Topic] = info
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"conversations": buildConversations(rows, stats, time.Now()),
	})
}

func (s *Server) adminChatMessages(w http.ResponseWriter, r *http.Request, topic string) {
	ctx := r.Context()
	// The topic must be a conversation companion knows: this endpoint hands over
	// private messages, so it answers for pairings in roulette_matches and
	// nothing else — never for an arbitrary Tinode topic name a caller invents.
	match, err := s.Store.MatchByTopic(ctx, topic)
	if err != nil {
		writeError(w, http.StatusNotFound, "no_such_chat", "conversation not found")
		return
	}
	s.logChatView(ctx, topic, match)

	msgs, err := s.Tinode.Messages(ctx, topic, chatMessageLimit)
	if err != nil {
		log.Printf("admin: read chat %s: %v", topic, err)
		writeError(w, http.StatusBadGateway, "tinode_failed", "could not read the conversation")
		return
	}
	media, err := s.Store.MediaByTopic(ctx, topic)
	if err != nil {
		// Attachments degrade to "недоступно"; the text is still worth serving.
		log.Printf("admin: media for chat %s: %v", topic, err)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"messages": s.mapChatMessages(ctx, msgs, media),
	})
}

// buildConversations joins what companion knows about a pairing (who, when)
// with what Tinode knows about its topic (how many messages, last activity),
// newest activity first. Pure so the response shape is testable without either.
func buildConversations(rows []store.ChatRow, stats map[string]tinode.TopicInfo, now time.Time) []chatConversation {
	out := make([]chatConversation, 0, len(rows))
	for _, row := range rows {
		c := chatConversation{
			ID:        row.Topic,
			A:         chatPeerOf(row.AID, row.AHash),
			B:         chatPeerOf(row.BID, row.BHash),
			CreatedAt: row.CreatedAt,
		}
		if st, ok := stats[row.Topic]; ok {
			c.Messages = st.SeqID
			if !st.TouchedAt.IsZero() {
				touched := st.TouchedAt
				c.LastMessageAt = &touched
				c.Live = now.Sub(touched) < chatLiveWindow
			}
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return conversationActivity(out[i]).After(conversationActivity(out[j]))
	})
	return out
}

// oldestChat is the match time of the earliest pairing in the list, shifted a
// second back because Tinode's filter is strictly `touchedat > since` and a
// topic is touched at creation — on the exact same millisecond as its match row
// on a fast machine. Zero rows yield the zero time, which asks for everything.
func oldestChat(rows []store.ChatRow) time.Time {
	oldest := time.Time{}
	for _, row := range rows {
		if oldest.IsZero() || row.CreatedAt.Before(oldest) {
			oldest = row.CreatedAt
		}
	}
	if oldest.IsZero() {
		return oldest
	}
	return oldest.Add(-time.Second)
}

// conversationActivity is the timestamp a conversation sorts by: its last
// message, or its creation while it has none (a freshly matched pair that has
// not spoken yet belongs at the top, not at the bottom).
func conversationActivity(c chatConversation) time.Time {
	if c.LastMessageAt != nil {
		return *c.LastMessageAt
	}
	return c.CreatedAt
}

// chatPeerOf renders a participant the way the panel wants them: the #ID as the
// display name and the zero-padded public id beside it. Emoji is empty on
// purpose — companion stores no avatar for a user (the anon persona is a
// per-match alias, not an identity), and the panel already substitutes its own
// placeholder for a missing one.
func chatPeerOf(id, hash int64) chatPeer {
	return chatPeer{
		ID:       strconv.FormatInt(id, 10),
		Nickname: store.FormatHashID(hash),
		PublicID: store.PadHashID(hash),
	}
}

// mapChatMessages flattens the ROOT read into the panel's message shape,
// resolving each sender's Tinode uid to a companion user id and each attachment
// ref through the media registry.
func (s *Server) mapChatMessages(ctx context.Context, msgs []tinode.Message, media map[string]string) []chatMessage {
	senders := map[string]string{} // tinode uid -> companion user id, per request
	out := make([]chatMessage, 0, len(msgs))
	for _, m := range msgs {
		kind, text, ref := decodeChatContent(m.Content)
		row := chatMessage{
			ID:   strconv.Itoa(m.SeqID),
			Kind: kind,
			// Tinode's read receipts are per-subscription, and the anon patch
			// blanks other members' subscription data — so "read" is not knowable
			// for the anon chats this section is mostly about. The panel does not
			// render the field; reporting a uniform "sent" is the honest answer
			// rather than a guess dressed as a receipt.
			Status:    "sent",
			CreatedAt: m.Timestamp,
			SenderID:  s.chatSenderID(ctx, senders, m.FromUID),
		}
		if text != "" {
			row.Text = &text
		}
		if ref != "" {
			if mk, ok := media[ref]; ok {
				url := ref
				row.MediaURL = &url
				row.MediaKind = &mk
			}
		}
		out = append(out, row)
	}
	return out
}

// chatSenderID resolves a Tinode uid to the companion user id the panel matches
// against the conversation's participants, memoized for the request (a two-party
// chat has at most two distinct senders). An unknown or blanked uid yields "".
func (s *Server) chatSenderID(ctx context.Context, cache map[string]string, uid string) string {
	if uid == "" {
		return ""
	}
	if id, ok := cache[uid]; ok {
		return id
	}
	id := ""
	if u, err := s.Store.UserByTinodeUID(ctx, uid); err == nil {
		id = strconv.FormatInt(u.ID, 10)
	}
	cache[uid] = id
	return id
}

// decodeChatContent flattens a Tinode message payload into (kind, text,
// attachment ref). Messages arrive either as a bare JSON string (a plain text
// send) or as Drafty — {"txt":"…","fmt":[…],"ent":[…]} — where an attachment is
// an entity carrying the upload ref. Anything unrecognised degrades to text with
// no ref rather than leaking raw JSON into the viewer.
func decodeChatContent(content []byte) (kind, text, ref string) {
	if len(content) == 0 {
		return "text", "", ""
	}
	var plain string
	if err := json.Unmarshal(content, &plain); err == nil {
		return "text", plain, ""
	}
	var doc struct {
		Txt string `json:"txt"`
		Ent []struct {
			Tp   string `json:"tp"`
			Data struct {
				Ref string `json:"ref"`
			} `json:"data"`
		} `json:"ent"`
	}
	if err := json.Unmarshal(content, &doc); err != nil {
		return "text", "", ""
	}
	for _, ent := range doc.Ent {
		if k := draftyKind(ent.Tp); k != "" && ent.Data.Ref != "" {
			return k, doc.Txt, ent.Data.Ref
		}
	}
	return "text", doc.Txt, ""
}

// draftyKind maps a Drafty entity tag to the media kind the panel switches on.
// "" means "not an attachment we render" (a link, a mention, a form).
func draftyKind(tp string) string {
	switch tp {
	case "IM":
		return "image"
	case "VD":
		return "video"
	case "AU":
		return "audio"
	case "EX":
		return "file"
	default:
		return ""
	}
}

// --- moderation journal -----------------------------------------------------

// chatViews remembers when each operator last had a conversation logged, so the
// panel's 5-second polling does not turn moderator_actions into a firehose. It
// is per-process and bounded by (operators × conversations they open), which is
// the same shape as the presence throttle in router.go.
var chatViews struct {
	sync.Mutex
	last map[string]time.Time
}

// logChatView appends the moderator_actions entry for opening a conversation,
// at most once per operator+conversation per chatViewThrottle. Best-effort: a
// journal write must not stop a moderator from reading a reported chat, so a
// failure is logged and the read proceeds.
func (s *Server) logChatView(ctx context.Context, topic string, match store.Match) {
	key := adminID(ctx) + "\x00" + topic
	now := time.Now()

	chatViews.Lock()
	if chatViews.last == nil {
		chatViews.last = map[string]time.Time{}
	}
	if last, ok := chatViews.last[key]; ok && now.Sub(last) < chatViewThrottle {
		chatViews.Unlock()
		return
	}
	chatViews.last[key] = now
	chatViews.Unlock()

	if err := s.Store.LogChatView(ctx, adminID(ctx), topic, match.UserA, match.UserB); err != nil {
		log.Printf("admin: journal chat view %s: %v", topic, err)
	}
}
