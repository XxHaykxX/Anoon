package api

import (
	"context"
	"reflect"
	"testing"

	"anoon/companion/internal/store"
)

// TestReportTarget covers both ways a report names its subject. Getting this
// wrong does not fail loudly — it turns a moderation path into a 400 — so each
// route in is pinned here.
func TestReportTarget(t *testing.T) {
	tests := []struct {
		name    string
		hashID  string
		topic   string
		inTopic bool
		want    reportTargetSource
	}{
		{
			// Friend chat: unchanged from before H2.
			name: "friend chat sends the peer's #ID", hashID: "#00042", topic: "usrPeer", inTopic: true,
			want: targetFromHashID,
		},
		{
			// Anon roulette: the client has only an alias, so it sends none.
			name: "anon match sends only the topic", topic: "grpAnon", inTopic: true,
			want: targetFromTopic,
		},
		{
			name: "friend chat report with no topic", hashID: "42",
			want: targetFromHashID,
		},
		{
			// Naming a conversation you were never in resolves to nobody.
			name: "someone else's match topic", topic: "grpOthers",
			want: targetNotInTopic,
		},
		{
			name: "neither #ID nor topic",
			want: targetMissing,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := reportTarget(tc.hashID, tc.topic, tc.inTopic); got != tc.want {
				t.Errorf("reportTarget(%q, %q, %v) = %d, want %d",
					tc.hashID, tc.topic, tc.inTopic, got, tc.want)
			}
		})
	}
}

// TestReportTargetResolvesTheAnonPeer walks the anon path end to end at the
// resolution level: a `matched` topic and no #ID must land on the peer of that
// match, and the same request from a non-member must resolve to nobody.
func TestReportTargetResolvesTheAnonPeer(t *testing.T) {
	ctx := context.Background()

	member, inTopic := topicMemberFor(ctx, testMembership, testCaller, "grpAnon")
	if !inTopic {
		t.Fatal("the caller is a member of grpAnon")
	}
	if src := reportTarget("", "grpAnon", inTopic); src != targetFromTopic {
		t.Fatalf("anon report source = %d, want targetFromTopic", src)
	}
	if member.PeerID != testPeer.ID {
		t.Errorf("anon report resolved to user %d, want the peer %d", member.PeerID, testPeer.ID)
	}

	// A stranger naming that same topic is not in it, so there is nobody to
	// report — the peer of someone else's match is never handed out.
	stranger := store.User{ID: 33, TinodeUID: "usrStrange"}
	member, inTopic = topicMemberFor(ctx, testMembership, stranger, "grpAnon")
	if inTopic || member.PeerID != 0 {
		t.Errorf("a non-member resolved to %+v, want no membership", member)
	}
	if src := reportTarget("", "grpAnon", inTopic); src != targetNotInTopic {
		t.Errorf("non-member report source = %d, want targetNotInTopic", src)
	}
}

// TestEscalationLegs pins which media a report reaches. Escalating is what
// suspends the "this will disappear" guarantee, so the selection must be the
// reported conversation and nothing else — which differs by topic shape.
func TestEscalationLegs(t *testing.T) {
	reporter := store.User{ID: 11, TinodeUID: "usrCaller"}

	tests := []struct {
		name     string
		member   topicMember
		reporter store.User
		topic    string
		want     []escalationLeg
	}{
		{
			// Roulette: one shared topic name, unique to the pairing.
			name:     "anon/revealed pair topic covers the whole topic",
			member:   topicMember{PeerID: 22},
			reporter: reporter,
			topic:    "grpAnon",
			want:     []escalationLeg{{topic: "grpAnon"}},
		},
		{
			// Friend chat: each side filed its media under the name IT uses,
			// so both halves are needed and each stays owner-scoped.
			name:     "p2p topic covers both members, each under their own name",
			member:   topicMember{PeerID: 22, P2P: true},
			reporter: reporter,
			topic:    "usrPeer",
			want: []escalationLeg{
				{topic: "usrPeer", owner: 11},
				{topic: "usrCaller", owner: 22},
			},
		},
		{
			name:     "p2p without the reporter's own uid skips the peer's half",
			member:   topicMember{PeerID: 22, P2P: true},
			reporter: store.User{ID: 11},
			topic:    "usrPeer",
			want:     []escalationLeg{{topic: "usrPeer", owner: 11}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := escalationLegs(tc.member, tc.reporter, tc.topic)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("escalationLegs() = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// TestEscalationLegsNeverSweepsAPeerWide covers the trap in p2p naming: `usrB`
// is not one conversation, it is every chat anyone has with B. No leg may
// select a p2p topic without an owner, or one report would flag strangers'
// media in unrelated chats.
func TestEscalationLegsNeverSweepsAPeerWide(t *testing.T) {
	reporter := store.User{ID: 11, TinodeUID: "usrCaller"}
	for _, leg := range escalationLegs(topicMember{PeerID: 22, P2P: true}, reporter, "usrPeer") {
		if leg.owner == 0 {
			t.Errorf("p2p leg %+v is not owner-scoped: it would reach every chat with that peer", leg)
		}
	}
}
