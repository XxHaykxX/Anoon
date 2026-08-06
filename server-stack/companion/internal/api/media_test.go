package api

import (
	"context"
	"errors"
	"testing"

	"anoon/companion/internal/store"
)

// errNoSuchUser is what the fake store returns for an unknown uid.
var errNoSuchUser = errors.New("no such user")

// fakeMembership stands in for the store in topicMemberFor: one roulette match,
// a uid→user index and a friendship set is everything the rule reads.
type fakeMembership struct {
	matches map[string]store.Match
	byUID   map[string]store.User
	friends map[[2]int64]bool
}

func (f fakeMembership) MatchByTopic(_ context.Context, topic string) (store.Match, error) {
	m, ok := f.matches[topic]
	if !ok {
		return store.Match{}, store.ErrNoMatch
	}
	return m, nil
}

func (f fakeMembership) UserByTinodeUID(_ context.Context, uid string) (store.User, error) {
	u, ok := f.byUID[uid]
	if !ok {
		return store.User{}, errNoSuchUser
	}
	return u, nil
}

func (f fakeMembership) AreFriends(_ context.Context, a, b int64) (bool, error) {
	return f.friends[[2]int64{a, b}] || f.friends[[2]int64{b, a}], nil
}

// The cast below: the caller is user 11, their peer is 22, a stranger is 33.
var (
	testCaller = store.User{ID: 11, TinodeUID: "usrCaller"}
	testPeer   = store.User{ID: 22, TinodeUID: "usrPeer"}

	testMembership = fakeMembership{
		matches: map[string]store.Match{
			// The anonymous phase, a revealed pair and a chat that has since
			// ended are all conversations the caller was really in.
			"grpAnon":     {ID: 1, Topic: "grpAnon", UserA: 11, UserB: 22, Status: "active"},
			"grpRevealed": {ID: 2, Topic: "grpRevealed", UserA: 22, UserB: 11, Status: "revealed"},
			"grpEnded":    {ID: 3, Topic: "grpEnded", UserA: 11, UserB: 22, Status: "ended"},
			"grpOthers":   {ID: 4, Topic: "grpOthers", UserA: 33, UserB: 44, Status: "active"},
		},
		byUID: map[string]store.User{
			"usrCaller":  testCaller,
			"usrPeer":    testPeer,
			"usrStrange": {ID: 33, TinodeUID: "usrStrange"},
		},
		friends: map[[2]int64]bool{{11, 22}: true},
	}
)

// TestTopicMemberFor covers both conversation shapes a report or a media
// reference can name: the anonymous roulette phase (grpXXX, membership from the
// match) and a friend chat (usrXXX, membership from the friendship). A stranger
// must be rejected in both.
func TestTopicMemberFor(t *testing.T) {
	tests := []struct {
		name     string
		topic    string
		wantOK   bool
		wantPeer int64
		wantP2P  bool
	}{
		{"anon roulette phase", "grpAnon", true, 22, false},
		{"revealed pair keeps its grp topic", "grpRevealed", true, 22, false},
		{"ended chat is still one we were in", "grpEnded", true, 22, false},
		{"friend chat (p2p topic)", "usrPeer", true, 22, true},
		{"someone else's match", "grpOthers", false, 0, false},
		{"unknown topic", "grpNope", false, 0, false},
		{"p2p topic of a non-friend", "usrStrange", false, 0, false},
		{"p2p topic naming an unknown uid", "usrGhost", false, 0, false},
		{"our own p2p topic name", "usrCaller", false, 0, false},
		{"empty topic", "", false, 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := topicMemberFor(context.Background(), testMembership, testCaller, tc.topic)
			if ok != tc.wantOK {
				t.Fatalf("topicMemberFor(%q) ok = %v, want %v", tc.topic, ok, tc.wantOK)
			}
			if got.PeerID != tc.wantPeer || got.P2P != tc.wantP2P {
				t.Errorf("topicMemberFor(%q) = %+v, want peer %d p2p %v",
					tc.topic, got, tc.wantPeer, tc.wantP2P)
			}
		})
	}
}

// TestValidMediaURL pins the allowlist POST /media applies to the ref it stores.
// The registry is rendered in the admin gallery, so a URL the caller chose is a
// link a moderator would click; only what this deployment's upload handler can
// return is accepted.
func TestValidMediaURL(t *testing.T) {
	valid := []string{
		"/v0/file/s/abc123.jpg",  // what uploadFile returns for a photo
		"/v0/file/s/dGVzdA.mp4",  // video
		"/v0/file/s/aXNhdA.webm", // voice message
		"/v0/file/s/xY-_9",       // no extension
	}
	for _, u := range valid {
		if !validMediaURL(u) {
			t.Errorf("validMediaURL(%q) = false, want true (legitimate upload ref)", u)
		}
	}

	invalid := []string{
		"",
		"https://evil.example/pwn.jpg",   // a URL the caller chose
		"//evil.example/v0/file/s/a.jpg", // protocol-relative host
		"javascript:alert(1)",            // not even http
		"/v0/file/s/",                    // no file
		"/v0/file/s/..",                  // traversal
		"/v0/file/s/../../etc/passwd",    // traversal
		"/v0/file/s/a/b.jpg",             // more than one segment
		"/v0/file/u/a.jpg",               // the upload path, not the download one
		"/v0/file/s/a.jpg?x=1",           // query
		"/v0/file/s/a.jpg#frag",          // fragment
		"/v0/file/s/a b.jpg",             // whitespace
		"/v0/file/s/a\\b.jpg",            // backslash
		"/v0/file/s/a\nb.jpg",            // control character
		" /v0/file/s/a.jpg",              // untrimmed (the handler trims first)
		"/v0/file/s/" + repeat(600, 'a'), // absurdly long
	}
	for _, u := range invalid {
		if validMediaURL(u) {
			t.Errorf("validMediaURL(%q) = true, want false", u)
		}
	}
}

// repeat builds a run of n copies of c.
func repeat(n int, c byte) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = c
	}
	return string(b)
}
