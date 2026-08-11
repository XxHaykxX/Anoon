package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
)

// stubExpo points expoPushURL at a local handler for the duration of a test.
// The real exp.host is never contacted.
func stubExpo(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(h)
	prev := expoPushURL
	expoPushURL = srv.URL
	t.Cleanup(func() {
		expoPushURL = prev
		srv.Close()
	})
	return srv
}

// TestExpoSendBatchPostsOneMessage pins the request shape Expo expects and the
// one field the phone actually navigates on. `data.tag` is not decoration: it
// is the only thing in the payload that says WHICH chat was tapped, so a
// notification without it can open the app but not the conversation.
func TestExpoSendBatchPostsOneMessage(t *testing.T) {
	var got []expoMessage
	stubExpo(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("request body is not a message array: %v (%s)", err, body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"1"},{"status":"ok","id":"2"}]}`)
	})

	sent, dead, err := expoSendBatch(context.Background(),
		[]string{"ExponentPushToken[aaa]", "ExponentPushToken[bbb]"},
		push.PushPayload{Title: "anoon", Body: "#00012: привет", Tag: "msg:grp7"})
	if err != nil {
		t.Fatalf("expoSendBatch: %v", err)
	}
	if sent != 2 || len(dead) != 0 {
		t.Fatalf("sent=%d dead=%v, want 2 and none", sent, dead)
	}
	if len(got) != 1 {
		t.Fatalf("want one message object carrying the whole batch, got %d", len(got))
	}
	m := got[0]
	if len(m.To) != 2 {
		t.Errorf("to = %v, want both tokens in one request", m.To)
	}
	if m.Body != "#00012: привет" || m.Title != "anoon" {
		t.Errorf("title/body did not survive: %q / %q", m.Title, m.Body)
	}
	if m.Data["tag"] != "msg:grp7" {
		t.Errorf("data.tag = %v, want the tag the tap handler routes on", m.Data["tag"])
	}
	if m.Priority != "high" {
		t.Errorf("priority = %q; a backgrounded phone is not woken without high", m.Priority)
	}
	if m.ChannelID != "default" {
		t.Errorf("channelId = %q, want the channel the app creates", m.ChannelID)
	}
}

// TestExpoSendBatchReportsOnlyDeadTokens is the pruning rule. DeviceNotRegistered
// means the install is gone and the row should go with it; every other failure
// is about this one delivery, and deleting a registration over a rate limit
// would silently switch that user's notifications off for good.
func TestExpoSendBatchReportsOnlyDeadTokens(t *testing.T) {
	stubExpo(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"data":[
			{"status":"ok","id":"1"},
			{"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}},
			{"status":"error","message":"slow down","details":{"error":"MessageRateExceeded"}}
		]}`)
	})

	tokens := []string{"ExponentPushToken[ok]", "ExponentPushToken[gone]", "ExponentPushToken[busy]"}
	sent, dead, err := expoSendBatch(context.Background(), tokens, push.PushPayload{Title: "anoon"})
	if err != nil {
		t.Fatalf("expoSendBatch: %v", err)
	}
	if sent != 1 {
		t.Errorf("sent = %d, want 1", sent)
	}
	if len(dead) != 1 || dead[0] != "ExponentPushToken[gone]" {
		t.Fatalf("dead = %v, want only the DeviceNotRegistered token", dead)
	}
}

// TestExpoSendBatchKeepsTokensOnTransportFailure: a 500 (or a dead network) must
// return an error and NO dead tokens. Reading an outage as "these phones are
// gone" would unregister every mobile user at once.
func TestExpoSendBatchKeepsTokensOnTransportFailure(t *testing.T) {
	stubExpo(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	})

	sent, dead, err := expoSendBatch(context.Background(),
		[]string{"ExponentPushToken[aaa]"}, push.PushPayload{Title: "anoon"})
	if err == nil {
		t.Fatal("a 500 from the push service must surface as an error")
	}
	if sent != 0 || len(dead) != 0 {
		t.Fatalf("sent=%d dead=%v, want nothing counted and nothing pruned", sent, dead)
	}
}

// TestExpoTokensOfSplitsTheTable is what keeps one table serving two device
// kinds: a browser row must never be posted to Expo, and a phone row must be
// found without a store change.
func TestExpoTokensOfSplitsTheTable(t *testing.T) {
	got := expoTokensOf([]store.PushSub{
		{Endpoint: "https://fcm.googleapis.com/fcm/send/abc"},
		{Endpoint: "expo:ExponentPushToken[phone]"},
		{Endpoint: "expo:"}, // truncated row: not a token, must not be sent
	})
	if len(got) != 1 || got[0] != "ExponentPushToken[phone]" {
		t.Fatalf("expoTokensOf = %v, want just the phone token", got)
	}
}

// TestValidExpoToken guards the write side. The token is posted to exp.host on
// every message for the life of the account, so junk must be refused at the
// door rather than stored and retried forever.
func TestValidExpoToken(t *testing.T) {
	good := []string{
		"ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
		"ExpoPushToken[abc-123_45.6]",
	}
	bad := []string{
		"",
		"ExponentPushToken[]",
		"ExponentPushToken[abc",
		"https://push.example/subscription/abc",
		"ExponentPushToken[abc] extra",
		strings.Repeat("ExponentPushToken[a]", 40),
	}
	for _, tok := range good {
		if !validExpoToken(tok) {
			t.Errorf("validExpoToken(%q) = false, want true", tok)
		}
	}
	for _, tok := range bad {
		if validExpoToken(tok) {
			t.Errorf("validExpoToken(%q) = true, want false", tok)
		}
	}
}

// TestExpoRowRoundTrips pins the storage convention the two ends agree on: the
// endpoint carries the prefix (so the sender can tell a phone from a browser)
// and both keys carry the token (so the store's takeover guard means "prove you
// hold this token").
func TestExpoRowRoundTrips(t *testing.T) {
	const tok = "ExponentPushToken[abc]"
	endpoint, p256dh, auth := expoRow(tok)
	if endpoint != expoEndpointPrefix+tok {
		t.Fatalf("endpoint = %q", endpoint)
	}
	if p256dh != tok || auth != tok {
		t.Fatalf("keys = %q / %q, want the token on both", p256dh, auth)
	}
	back := expoTokensOf([]store.PushSub{{Endpoint: endpoint}})
	if len(back) != 1 || back[0] != tok {
		t.Fatalf("round trip lost the token: %v", back)
	}
}
