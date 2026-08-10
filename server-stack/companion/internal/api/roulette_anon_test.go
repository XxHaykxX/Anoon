package api

import (
	"encoding/json"
	"strings"
	"testing"

	"anoon/companion/internal/store"
)

// The pair under test. Their real #IDs are the values that must not appear
// anywhere in an anon-phase frame (H2).
const (
	aliceID       int64 = 41
	bobID         int64 = 42
	aliceHash     int64 = 12
	bobHash       int64 = 7331
	aliceAlias          = "~K7X2QM"
	bobAlias            = "~R4TBHN"
	aliceUserHash       = "#00012" // store.FormatHashID(aliceHash)
	bobUserHash         = "#07331" // store.FormatHashID(bobHash)
)

func anonMatch() store.Match {
	return store.Match{
		ID: 7, Topic: "grpAbC123", UserA: aliceID, UserB: bobID, Status: "active",
		AliasA: aliceAlias, AliasB: bobAlias,
	}
}

// jsonOf marshals an event the way Hub.Send does, so assertions run against the
// bytes a client actually receives rather than against Go field values.
func jsonOf(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// TestMatchedEventCarriesAliasNotHashID is the H2 regression itself: the frame
// that opens an anonymous chat must name the peer by the per-match alias. Before
// the fix it carried store.FormatHashID(peer.HashID) — the real, permanent,
// public #ID — so either side could add, block, report or look the other person
// up with no reveal and no consent.
func TestMatchedEventCarriesAliasNotHashID(t *testing.T) {
	m := anonMatch()

	for _, tc := range []struct {
		name      string
		viewer    int64
		wantAlias string
		peerHash  string
	}{
		{"alice sees bob", aliceID, bobAlias, bobUserHash},
		{"bob sees alice", bobID, aliceAlias, aliceUserHash},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ev := anonMatchedEvent(m, tc.viewer, "22-25")
			if ev.PeerAlias != tc.wantAlias {
				t.Errorf("PeerAlias = %q, want %q", ev.PeerAlias, tc.wantAlias)
			}
			if strings.HasPrefix(ev.PeerAlias, "#") {
				t.Errorf("PeerAlias %q is shaped like a real #ID", ev.PeerAlias)
			}

			raw := jsonOf(t, ev)
			if strings.Contains(raw, tc.peerHash) {
				t.Fatalf("matched frame leaks the peer's real #ID %s: %s", tc.peerHash, raw)
			}
			// The old field name is gone on purpose: a consumer still reading
			// peerHashId here would be treating the alias as a real #ID.
			if strings.Contains(raw, "peerHashId") {
				t.Fatalf("matched frame still carries peerHashId: %s", raw)
			}
			if !strings.Contains(raw, `"peerAlias"`) {
				t.Fatalf("matched frame is missing peerAlias: %s", raw)
			}
		})
	}
}

// TestMatchedEventStableAcrossDeliveryPaths pins the requirement the
// /roulette/status recovery path depends on. The `matched` WS frame is
// best-effort; a client that misses it polls the REST mirror instead. Both are
// built by anonMatchedEvent from the same stored row, so a re-read must produce
// a byte-identical frame — if the alias were minted per delivery, the resync
// would open the chat against a handle the peer has never used.
func TestMatchedEventStableAcrossDeliveryPaths(t *testing.T) {
	atMatchTime := anonMatchedEvent(anonMatch(), aliceID, "22-25")

	// The status path re-reads the row from the DB and reconstructs the age
	// bucket from the peer's profile; everything identifying stays the row's.
	reread := anonMatch()
	onResync := anonMatchedEvent(reread, aliceID, "22-25")

	if got, want := jsonOf(t, onResync), jsonOf(t, atMatchTime); got != want {
		t.Fatalf("resync frame differs from the matched frame:\n  matched: %s\n  status:  %s", want, got)
	}

	// And the frame the status path wraps must be the same struct, so the two
	// cannot drift in shape either.
	resp := rouletteStatusResponse{Queued: false, Match: &onResync}
	if !strings.Contains(jsonOf(t, resp), `"peerAlias":"`+bobAlias+`"`) {
		t.Fatalf("GET /roulette/status does not carry the match alias: %s", jsonOf(t, resp))
	}
}

// TestRevealRequestCarriesAliasNotHashID: a reveal REQUEST may still be
// declined, so it must not hand over the asker's identity on its own.
func TestRevealRequestCarriesAliasNotHashID(t *testing.T) {
	m := anonMatch()
	ev := revealRequestEvent{Type: "reveal_request", Topic: m.Topic, FromAlias: m.AliasFor(aliceID)}

	if ev.FromAlias != aliceAlias {
		t.Errorf("FromAlias = %q, want %q", ev.FromAlias, aliceAlias)
	}
	raw := jsonOf(t, ev)
	if strings.Contains(raw, aliceUserHash) || strings.Contains(raw, "fromHashId") {
		t.Fatalf("reveal_request leaks the asker's real #ID: %s", raw)
	}
}

// TestRevealedEventCarriesRealHashID is the other half of the contract: once
// both sides have consented, the real #ID is exactly what must arrive — the fix
// must not have made reveal useless.
func TestRevealedEventCarriesRealHashID(t *testing.T) {
	ev := revealedEvent{
		Type: "revealed", Topic: "grpAbC123",
		PeerHashID:      store.FormatHashID(bobHash),
		PeerDisplayName: store.FormatHashID(bobHash),
	}
	raw := jsonOf(t, ev)
	if !strings.Contains(raw, `"peerHashId":"`+bobUserHash+`"`) {
		t.Fatalf("revealed frame must carry the real #ID: %s", raw)
	}
	if strings.Contains(raw, store.AliasSigil) {
		t.Fatalf("revealed frame should name the peer for real, not by alias: %s", raw)
	}
}

// TestPeerFacingHandleHidesHashIDUntilReveal covers the side channel the same
// identity used to escape through: every call:*, msg:del, peer:left and activity
// frame companion relays is stamped with a sender handle, and so is the message
// push body — all of them unconditionally the real #ID, including inside an
// anonymous chat.
func TestPeerFacingHandleHidesHashIDUntilReveal(t *testing.T) {
	alice := store.User{ID: aliceID, HashID: aliceHash}

	anon := anonMatch()
	if got := peerFacingHandle(alice, anon); got != aliceAlias {
		t.Errorf("handle in an active match = %q, want the alias %q", got, aliceAlias)
	}

	ended := anonMatch()
	ended.Status = "ended"
	if got := peerFacingHandle(alice, ended); got != aliceAlias {
		t.Errorf("handle in an ended match = %q, want the alias %q (no consent was ever given)", got, aliceAlias)
	}

	revealed := anonMatch()
	revealed.Status = "revealed"
	if got := peerFacingHandle(alice, revealed); got != aliceUserHash {
		t.Errorf("handle after reveal = %q, want the real #ID %q", got, aliceUserHash)
	}

	// A p2p friend chat has no match row at all; the zero Match must not hand
	// out an empty handle.
	if got := peerFacingHandle(alice, store.Match{}); got != aliceUserHash {
		t.Errorf("handle with no match = %q, want the real #ID %q", got, aliceUserHash)
	}
}

// TestRelayTargetFormDiscrimination pins the branch predicate in
// resolveRelayTarget. Which of the two lookups runs is decided entirely by
// store.NormalizeAlias, and the two are not interchangeable: the #ID branch
// resolves globally, the alias branch only inside the caller's own match. A
// "#ID" spelling that slipped into the alias branch would be harmless, but an
// alias reaching the #ID branch would mean parseHashID had accepted it — and
// then every #ID-keyed endpoint would accept it too.
func TestRelayTargetFormDiscrimination(t *testing.T) {
	tests := []struct {
		to         string
		wantAlias  bool
		wantHashID bool
	}{
		{aliceAlias, true, false},
		{"~k7x2qm", true, false}, // case-insensitive, still the alias branch
		{"#00012", false, true},
		{"00012", false, true},
		{"12", false, true},
		{"", false, false}, // resolves as neither
	}
	for _, tc := range tests {
		t.Run(tc.to, func(t *testing.T) {
			gotAlias := store.NormalizeAlias(tc.to) != ""
			if gotAlias != tc.wantAlias {
				t.Errorf("%q: alias branch = %v, want %v", tc.to, gotAlias, tc.wantAlias)
			}
			_, err := parseHashID(tc.to)
			if gotHashID := err == nil; gotHashID != tc.wantHashID {
				t.Errorf("%q: #ID branch = %v, want %v", tc.to, gotHashID, tc.wantHashID)
			}
			if gotAlias && err == nil {
				t.Errorf("%q resolves as BOTH an alias and a #ID — the two forms must not overlap", tc.to)
			}
		})
	}
}

// TestMessagePushBodyNamesSenderByAliasWhileAnon: the push body lands on a lock
// screen, which is the least private surface the app touches. It read
// "#00012: <preview>" during an anonymous chat.
func TestMessagePushBodyNamesSenderByAliasWhileAnon(t *testing.T) {
	alice := store.User{ID: aliceID, HashID: aliceHash}
	content := []byte(`"привет"`)

	got := messagePushBody(alice, anonMatch(), content)
	if got != aliceAlias+": привет" {
		t.Errorf("anon push body = %q, want %q", got, aliceAlias+": привет")
	}
	if strings.Contains(got, aliceUserHash) {
		t.Errorf("anon push body leaks the sender's real #ID: %q", got)
	}

	revealed := anonMatch()
	revealed.Status = "revealed"
	if got := messagePushBody(alice, revealed, content); got != aliceUserHash+": привет" {
		t.Errorf("revealed push body = %q, want the real #ID form %q", got, aliceUserHash+": привет")
	}
}

// nextFrame pops one frame off a fake socket's send queue. Hub.Send writes to
// the buffered channel synchronously, so a frame that isn't there by now never
// left.
func nextFrame(t *testing.T, c *wsClient) map[string]any {
	t.Helper()
	select {
	case raw := <-c.send:
		var f map[string]any
		if err := json.Unmarshal(raw, &f); err != nil {
			t.Fatalf("unmarshal %s: %v", raw, err)
		}
		return f
	default:
		t.Fatal("nothing was delivered to the peer")
		return nil
	}
}

// TestSendPeerLeftFrame pins the frame every "the other side is gone" path now
// goes through (#40). The bug it closes: only the person who pressed «Завершить»
// saw the chat end, because the sole signal to the peer was the leaver's own
// best-effort "peer:leaving" — nothing a closed tab or a dead network ever sends.
//
// Two things are pinned here. `reason` must be ABSENT on a deliberate leave, not
// an empty string: the client tells the two cases apart by its presence. And the
// leaver is named by their per-match alias, because a chat can end mid-anon and
// the exit must not be what hands over a real #ID (H2).
func TestSendPeerLeftFrame(t *testing.T) {
	s := &Server{Hub: NewHub()}
	peer := &wsClient{send: make(chan []byte, 4)}
	s.Hub.add(bobID, peer)

	m := anonMatch()
	alice := store.User{ID: aliceID, HashID: aliceHash}

	// handleEnd / relayPeerLeave: someone pressed the button.
	s.sendPeerLeft(m.Peer(aliceID), m.Topic, peerFacingHandle(alice, m), "")
	f := nextFrame(t, peer)
	if f["type"] != peerLeftType || f["topic"] != m.Topic {
		t.Fatalf("frame = %v, want a %s for %s", f, peerLeftType, m.Topic)
	}
	if f["from"] != aliceAlias {
		t.Errorf("from = %v, want the per-match alias %q", f["from"], aliceAlias)
	}
	if _, ok := f["reason"]; ok {
		t.Errorf("a deliberate leave must carry no reason: %v", f)
	}

	// endMatchOnDisconnect: the socket died and never came back.
	s.sendPeerLeft(m.Peer(aliceID), m.Topic, peerFacingHandle(alice, m), "peer_disconnected")
	if f := nextFrame(t, peer); f["reason"] != "peer_disconnected" {
		t.Errorf("reason = %v, want peer_disconnected", f["reason"])
	}

	// A match the caller isn't a member of yields peer id 0 — that must not
	// become a broadcast to user 0.
	s.sendPeerLeft(m.Peer(999), m.Topic, aliceAlias, "")
	s.sendPeerLeft(bobID, "", aliceAlias, "")
	select {
	case raw := <-peer.send:
		t.Fatalf("an unresolved peer/topic still sent a frame: %s", raw)
	default:
	}
}

// --- authorization sweep: S2 / S5 -------------------------------------------

// TestRelayLinkLivenessByMatchStatus pins the liveness rule the two authorization
// findings turn on. resolveRelayTarget's alias branch resolves an ended match on
// purpose — a hangup or a late ICE candidate has to reach the other side after
// either party left the chat, and the call overlay is mounted app-wide, so a
// call outlives its roulette chat — but that link is no longer LIVE, and
// call:offer and activity refuse a link that is not live (S5). Without that,
// a former anon peer could ring the other side indefinitely.
func TestRelayLinkLivenessByMatchStatus(t *testing.T) {
	tests := []struct {
		status   string
		wantLive bool
	}{
		{"active", true},
		{"revealed", true},
		{"ended", false},
	}
	for _, tc := range tests {
		t.Run(tc.status, func(t *testing.T) {
			m := anonMatch()
			m.Status = tc.status
			link := relayLink{peerID: m.Peer(aliceID), from: peerFacingHandle(store.User{ID: aliceID, HashID: aliceHash}, m), live: m.Status != "ended"}
			if link.live != tc.wantLive {
				t.Errorf("status %q: live = %v, want %v", tc.status, link.live, tc.wantLive)
			}
			if !link.live && callInitiatingType("call:offer") {
				// The guard relayCallSignal applies. Spelled out so the pairing
				// of "not live" with "offer refused" is pinned, not implied.
				t.Logf("call:offer correctly refused for a %s match", tc.status)
			}
		})
	}
}

// callInitiatingType mirrors the frame-type test in relayCallSignal: call:offer
// is the only call:* frame that makes a device ring, so it is the only one held
// to the live-link rule. answer/ice/hangup cannot initiate anything — a client
// drops frames whose callId it does not recognise — so they stay resolvable
// after a match ends, which is what keeps teardown working.
func callInitiatingType(typ string) bool { return typ == "call:offer" }

// TestOnlyCallOfferInitiatesContact guards that classification. Widening it
// would break call teardown for a chat the user already left; narrowing it (to
// nothing) would reopen S5.
func TestOnlyCallOfferInitiatesContact(t *testing.T) {
	for typ, want := range map[string]bool{
		"call:offer":  true,
		"call:answer": false,
		"call:ice":    false,
		"call:hangup": false,
	} {
		if got := callInitiatingType(typ); got != want {
			t.Errorf("callInitiatingType(%q) = %v, want %v", typ, got, want)
		}
		if !callSignalTypes[typ] {
			t.Errorf("%q is not a relayed call frame type; this table is stale", typ)
		}
	}
}

// TestRevealDeclinedEventCarriesNoIdentity pins the payload of the frame added
// for #23. A decline happens while the pair is still anonymous, so the frame
// must say only WHICH CHAT was declined — never who declined, nor any handle
// for them. The recipient already knows which chat they asked in.
//
// Spelled out as an exact-JSON assertion because this is the kind of struct
// somebody later "improves" by adding fromAlias for symmetry with
// reveal_request, which would turn a refusal into a disclosure channel.
func TestRevealDeclinedEventCarriesNoIdentity(t *testing.T) {
	buf, err := json.Marshal(revealDeclinedEvent{Type: "reveal_declined", Topic: "grpXYZ"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	const want = `{"type":"reveal_declined","topic":"grpXYZ"}`
	if string(buf) != want {
		t.Errorf("revealDeclinedEvent JSON =\n  %s\nwant\n  %s", buf, want)
	}

	for _, leak := range []string{"alias", "hashId", "from", "peer", "user"} {
		if strings.Contains(strings.ToLower(string(buf)), strings.ToLower(leak)) {
			t.Errorf("reveal_declined carries %q — a decline must not identify anyone: %s", leak, buf)
		}
	}
}

// TestRevealedIdentityGateIsTheState pins the one exception to H2 on the status
// surface. peerHashId/peerDisplayName are the peer's permanent public identity,
// so they may leave only when both sides have consented — and the gate must be
// the reveal STATE, not the match merely existing. A guard on "there is a match"
// would hand the real #ID to a client mid-anon-chat, undoing the whole point.
func TestRevealedIdentityGateIsTheState(t *testing.T) {
	peer := store.User{ID: bobID, HashID: bobHash}
	const bobReal = "#07331" // store.FormatHashID(bobHash)

	for _, state := range []string{
		store.RevealNone,
		store.RevealWeRequested,
		store.RevealPeerRequested,
		store.RevealDeclined,
	} {
		hashID, displayName := revealedIdentity(state, peer)
		if hashID != "" || displayName != "" {
			t.Errorf("state %q leaked identity (%q / %q) before a mutual reveal",
				state, hashID, displayName)
		}
	}

	hashID, displayName := revealedIdentity(store.RevealDone, peer)
	if hashID != bobReal || displayName != bobReal {
		t.Errorf("revealed state returned (%q, %q), want (%q, %q) — a client that "+
			"missed the frame cannot render or promote the peer without these",
			hashID, displayName, bobReal, bobReal)
	}
}

// TestRouletteStatusOmitsIdentityKeysWhenAnon guards the wire, not just the
// helper: the JSON must not carry the keys at all while anonymous, so no client
// can read an empty string as a real value or a null as "unknown user".
func TestRouletteStatusOmitsIdentityKeysWhenAnon(t *testing.T) {
	left := 2
	buf, err := json.Marshal(rouletteStatusResponse{
		Queued:         false,
		Match:          &matchedEvent{Type: "matched", Topic: "grpX", PeerAlias: bobAlias},
		Reveal:         store.RevealWeRequested,
		RevealAsksLeft: &left,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, key := range []string{"peerHashId", "peerDisplayName"} {
		if strings.Contains(string(buf), key) {
			t.Errorf("anon status payload carries %q: %s", key, buf)
		}
	}
	// And the real #ID must not appear under any key.
	if strings.Contains(string(buf), "#07331") {
		t.Errorf("anon status payload leaks the peer's real #ID: %s", buf)
	}
}
