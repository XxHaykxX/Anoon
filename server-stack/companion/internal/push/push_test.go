package push

import (
	"testing"

	"anoon/companion/internal/store"
)

// A phone's Expo token lives in the same table as the browsers' Web Push
// subscriptions (endpoint "expo:ExponentPushToken[…]") so unsubscribe, pruning
// and account deletion keep working unchanged. It must never reach webpush,
// which would fail to decode the keys and log a line per phone per push.
func TestWebPushOnly(t *testing.T) {
	subs := []store.PushSub{
		{Endpoint: "https://fcm.googleapis.com/fcm/send/aaa"},
		{Endpoint: "expo:ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"},
		{Endpoint: "https://updates.push.services.mozilla.com/wpush/v2/bbb"},
		{Endpoint: "expo:ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]"},
	}

	got := webPushOnly(subs)

	if len(got) != 2 {
		t.Fatalf("kept %d subscriptions, want 2: %+v", len(got), got)
	}
	for _, sub := range got {
		if sub.Endpoint[:5] == "expo:" {
			t.Errorf("expo subscription survived the filter: %q", sub.Endpoint)
		}
	}

	// The caller's slice is reused elsewhere (Broadcast counts against the full
	// load), so the filter must not write through its backing array.
	if subs[1].Endpoint[:5] != "expo:" {
		t.Errorf("input slice was overwritten: %+v", subs)
	}
}

func TestWebPushOnly_AllPhones(t *testing.T) {
	got := webPushOnly([]store.PushSub{
		{Endpoint: "expo:ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]"},
	})
	if len(got) != 0 {
		t.Fatalf("expected nothing to send, got %+v", got)
	}
}
