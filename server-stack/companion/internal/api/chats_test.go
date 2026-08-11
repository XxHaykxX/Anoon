package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"anoon/companion/internal/store"
	"anoon/companion/internal/tinode"
)

// The section hands over two people's private messages, so the first thing worth
// proving is that it is behind the same gate as every other /admin/* route: this
// Server has no AdminSecret, and adminOnly must turn both shapes away before any
// handler (and therefore any Tinode read) runs. Nil Store/Tinode make that
// load-bearing — reaching a handler here would panic rather than leak, but it
// would still mean the route was open.
func TestAdminChatsRequireAdminGate(t *testing.T) {
	h := (&Server{Hub: NewHub()}).Handler()

	for _, path := range []string{"/admin/chats", "/admin/chats?id=grpAnon"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "203.0.113.9:5000"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		switch rec.Code {
		case http.StatusMethodNotAllowed, http.StatusNotFound:
			t.Fatalf("GET %s is not routed (got %d) — the panel calls it", path, rec.Code)
		case http.StatusServiceUnavailable, http.StatusUnauthorized, http.StatusForbidden:
			// Routed and refused at the admin gate: what we want.
		default:
			t.Fatalf("GET %s answered %d without an admin secret", path, rec.Code)
		}
	}
}

var chatRows = []store.ChatRow{
	{Topic: "grpQuiet", Status: "ended", AID: 11, AHash: 12, BID: 22, BHash: 34, CreatedAt: time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)},
	{Topic: "grpLive", Status: "active", AID: 11, AHash: 12, BID: 33, BHash: 7, CreatedAt: time.Date(2026, 8, 1, 8, 0, 0, 0, time.UTC)},
}

func TestBuildConversationsShape(t *testing.T) {
	now := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	stats := map[string]tinode.TopicInfo{
		"grpLive":  {Topic: "grpLive", SeqID: 12, TouchedAt: now.Add(-time.Minute)},
		"grpQuiet": {Topic: "grpQuiet", SeqID: 3, TouchedAt: now.Add(-2 * time.Hour)},
	}

	convs := buildConversations(chatRows, stats, now)
	if len(convs) != 2 {
		t.Fatalf("got %d conversations, want 2", len(convs))
	}

	// Newest activity first, regardless of creation order.
	if convs[0].ID != "grpLive" {
		t.Fatalf("first conversation = %q, want grpLive (most recent message)", convs[0].ID)
	}
	live, quiet := convs[0], convs[1]

	if !live.Live {
		t.Fatal("a conversation whose last message is a minute old must be marked live")
	}
	if quiet.Live {
		t.Fatal("a conversation last touched two hours ago must not be marked live")
	}
	if live.Messages != 12 {
		t.Fatalf("messages = %d, want 12 (the topic's seq id)", live.Messages)
	}
	if live.LastMessageAt == nil || !live.LastMessageAt.Equal(now.Add(-time.Minute)) {
		t.Fatalf("lastMessageAt = %v, want the topic's touched_at", live.LastMessageAt)
	}
	// Peers are named by #ID: nickname carries the sigil, publicId is padded and
	// bare — the panel renders "#" itself.
	if live.A.ID != "11" || live.A.Nickname != "#00012" || live.A.PublicID != "00012" {
		t.Fatalf("peer A = %+v, want id 11 / #00012 / 00012", live.A)
	}
	if live.B.PublicID != "00007" {
		t.Fatalf("peer B publicId = %q, want 00007", live.B.PublicID)
	}
}

// A topic Tinode said nothing about (never carried a message, or the ROOT read
// failed) must still list — with no counters and a null lastMessageAt, not a
// 1970 timestamp — and must sort by when the pair was matched.
func TestBuildConversationsWithoutTopicStats(t *testing.T) {
	now := time.Date(2026, 8, 11, 12, 0, 0, 0, time.UTC)
	convs := buildConversations(chatRows, map[string]tinode.TopicInfo{}, now)

	if len(convs) != 2 {
		t.Fatalf("got %d conversations, want 2", len(convs))
	}
	if convs[0].ID != "grpQuiet" {
		t.Fatalf("first conversation = %q, want grpQuiet (matched later)", convs[0].ID)
	}
	for _, c := range convs {
		if c.LastMessageAt != nil {
			t.Fatalf("%s: lastMessageAt = %v, want null", c.ID, c.LastMessageAt)
		}
		if c.Messages != 0 || c.Live {
			t.Fatalf("%s: got messages=%d live=%v, want 0/false", c.ID, c.Messages, c.Live)
		}
	}
	// The panel reads lastMessageAt as `string | null`; null must survive JSON.
	body, err := json.Marshal(convs[0])
	if err != nil {
		t.Fatalf("marshal conversation: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal conversation: %v", err)
	}
	if v, ok := decoded["lastMessageAt"]; !ok || v != nil {
		t.Fatalf("lastMessageAt in JSON = %v, want null", v)
	}
}

// The window handed to Tinode decides whether the counters exist at all: the
// server filters topics by `touchedat > since`, so a window that starts after
// the oldest pairing on the page silently drops its counts. It must therefore be
// the EARLIEST match time, and strictly before it — a topic is touched at
// creation, on the same millisecond as its match row.
func TestOldestChatCoversEveryRow(t *testing.T) {
	since := oldestChat(chatRows)
	for _, row := range chatRows {
		if !since.Before(row.CreatedAt) {
			t.Fatalf("window starts at %v, not before pairing %s (%v)", since, row.Topic, row.CreatedAt)
		}
	}
	if !oldestChat(nil).IsZero() {
		t.Fatal("an empty page must ask for everything (zero time), not for a window")
	}
}

func TestDecodeChatContent(t *testing.T) {
	cases := []struct {
		name            string
		raw             string
		kind, text, ref string
	}{
		{"plain string send", `"привет"`, "text", "привет", ""},
		{"drafty text", `{"txt":"привет","fmt":[{"at":0,"len":6,"tp":"ST"}]}`, "text", "привет", ""},
		{"image attachment", `{"txt":" ","ent":[{"tp":"IM","data":{"ref":"/v0/file/s/abc","mime":"image/jpeg"}}]}`, "image", " ", "/v0/file/s/abc"},
		{"voice message", `{"txt":" ","ent":[{"tp":"AU","data":{"ref":"/v0/file/s/voice"}}]}`, "audio", " ", "/v0/file/s/voice"},
		// A link entity is not an attachment: it must not turn the message into media.
		{"link entity", `{"txt":"see anoon.app","ent":[{"tp":"LN","data":{"url":"https://anoon.app"}}]}`, "text", "see anoon.app", ""},
		{"empty payload", ``, "text", "", ""},
		{"garbage", `not json at all`, "text", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			kind, text, ref := decodeChatContent([]byte(tc.raw))
			if kind != tc.kind || text != tc.text || ref != tc.ref {
				t.Fatalf("got (%q, %q, %q), want (%q, %q, %q)", kind, text, ref, tc.kind, tc.text, tc.ref)
			}
		})
	}
}
