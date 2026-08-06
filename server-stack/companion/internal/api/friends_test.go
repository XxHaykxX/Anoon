package api

import (
	"encoding/json"
	"strings"
	"testing"

	"anoon/companion/internal/store"
)

// TestAvatarTone pins the Go tone function to the frontend's `toneFor`. The
// expectations were produced by running the real client implementation
// (frontend/src/store/slices.ts):
//
//	toneFor = (key) => [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 6
//
// on live tinode uids. If these drift, the same person renders one colour in
// friend search and a different one in Contacts.
func TestAvatarTone(t *testing.T) {
	tests := []struct {
		key  string
		want int
	}{
		{"usrrUOCmNCh0aA", 5},
		{"usrIw-k1qaysQo", 3},
		{"usr_9CWvB3-c_s", 5},
		{"usro5WlIWkq6NI", 0},
		{"a", 1},
		{"", 0}, // a user with no uid still gets a deterministic tone
	}
	for _, tc := range tests {
		if got := avatarTone(tc.key); got != tc.want {
			t.Errorf("avatarTone(%q) = %d, want %d", tc.key, got, tc.want)
		}
	}
}

// TestAvatarToneInRange guards the contract the client's palette relies on:
// the tone indexes a 6-entry colour array, so it must always be 0..5.
func TestAvatarToneInRange(t *testing.T) {
	for _, k := range []string{"", "usr", "usrZZZZZZZZZZZ", "#00042", "\x00\x01"} {
		if got := avatarTone(k); got < 0 || got > 5 {
			t.Errorf("avatarTone(%q) = %d, out of range 0..5", k, got)
		}
	}
}

// TestRelationWireValues pins the relation strings to the `relation` union in
// frontend/src/types/companion.ts. These go out on the wire and the client
// switches on them; a near-miss silently falls through to no CTA.
func TestRelationWireValues(t *testing.T) {
	want := map[store.Relation]string{
		store.RelationNone:            "none",
		store.RelationFriends:         "friends",
		store.RelationRequestSent:     "request_sent",
		store.RelationRequestReceived: "request_received",
		store.RelationBlocked:         "blocked",
		store.RelationSelf:            "self",
	}
	for rel, s := range want {
		if string(rel) != s {
			t.Errorf("relation constant = %q, want %q", string(rel), s)
		}
	}
	// The union has exactly these six members. A seventh constant added here
	// without adding it to the TS union would be an unhandled value on the
	// client, so this count is deliberately load-bearing.
	if len(want) != 6 {
		t.Errorf("expected 6 relation values to match the TS union, have %d", len(want))
	}
}

// TestFriendSearchItemJSON pins the wire field names to FriendSearchResult.
// All four are REQUIRED on the client, so none may be omitted or renamed —
// relation and avatarTone going unsent is the exact bug this endpoint had.
func TestFriendSearchItemJSON(t *testing.T) {
	buf, err := json.Marshal(friendSearchItem{
		HashID:      "#00010",
		DisplayName: "#00010",
		AvatarTone:  5,
		Relation:    string(store.RelationFriends),
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	const want = `{"hashId":"#00010","displayName":"#00010","avatarTone":5,"relation":"friends"}`
	if string(buf) != want {
		t.Errorf("friendSearchItem JSON =\n  %s\nwant\n  %s", buf, want)
	}

	// A zero-valued item must still carry every key — `omitempty` on any of
	// these would drop tone 0 or relation "" and break the required-field
	// contract in a way only some users would ever hit.
	buf, err = json.Marshal(friendSearchItem{})
	if err != nil {
		t.Fatalf("marshal zero: %v", err)
	}
	for _, key := range []string{"hashId", "displayName", "avatarTone", "relation"} {
		if !strings.Contains(string(buf), `"`+key+`"`) {
			t.Errorf("zero-valued friendSearchItem drops %q: %s", key, buf)
		}
	}
}

// TestFriendRequestAllowed pins the block gate on POST /friends/request. Until
// this existed, a block only fed the roulette's exclude set, so someone you
// blocked could still put a notification on your phone whenever they liked.
func TestFriendRequestAllowed(t *testing.T) {
	tests := []struct {
		rel  store.Relation
		want bool
	}{
		{store.RelationNone, true},
		{store.RelationFriends, true},
		{store.RelationRequestSent, true},     // re-sending is an idempotent no-op
		{store.RelationRequestReceived, true}, // requesting back is how you accept
		{store.RelationSelf, true},            // refused earlier, by the self_request check
		{store.RelationBlocked, false},
	}
	for _, tc := range tests {
		t.Run(string(tc.rel), func(t *testing.T) {
			if got := friendRequestAllowed(tc.rel); got != tc.want {
				t.Errorf("friendRequestAllowed(%q) = %v, want %v", tc.rel, got, tc.want)
			}
		})
	}
}

// The property this gate leans on — that store.Relations reports RelationBlocked
// whoever set the block, so the request is stopped in either direction — is
// pinned next to its implementation, in TestApplyRelationRow (store package).
// Making Relations directional would fail there, not here.
