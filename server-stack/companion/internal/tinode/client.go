// Package tinode holds the companion's ROOT-bot gRPC connection to the Tinode
// server. It dials the Node service, opens a persistent MessageLoop stream,
// authenticates as the ROOT account, and keeps the stream alive with reconnect.
//
// The ROOT account (flagged via `tinode-db --make_root`) lets the companion act
// on_behalf_of any user in a single stream — this is how we will later create
// anonymous topics, subscribe matched pairs, lift the anon flag on reveal, ban
// (acc state) and mute (drop W). Those actions are stubbed with TODOs here; this
// file only establishes and maintains the connection.
//
// Pattern reference: server/chatbot (Python/C#) and Tinode session.go MessageLoop.
package tinode

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"anoon/companion/internal/pbx"
)

// clientVersion is advertised in the {hi} handshake.
const clientVersion = "0.22"

// ErrNotConnected is returned by ROOT actions issued while no live gRPC stream
// exists (before the first connect or during a reconnect gap).
var ErrNotConnected = errors.New("tinode: not connected")

// Client maintains the persistent ROOT gRPC session to Tinode.
//
// Sends are serialized through sendMu (a gRPC client stream forbids concurrent
// Send). Every request tagged with an id registers a channel in pending; the
// single-threaded readLoop routes the matching {ctrl} reply back to it, which
// is how synchronous ROOT actions (account creation, ban, …) await their result.
type Client struct {
	addr   string
	login  string
	secret string

	sendMu sync.Mutex // serializes stream.Send

	mu      sync.Mutex // guards conn, stream, pending
	conn    *grpc.ClientConn
	stream  pbx.Node_MessageLoopClient
	pending map[string]chan *pbx.ServerCtrl

	reqSeq atomic.Uint64 // source of unique request ids

	readyOnce sync.Once
	ready     chan struct{} // closed once the ROOT login succeeds

	// tokens caches resolved auth tokens (token→uid) to skip the throwaway
	// gRPC session ResolveToken would otherwise open on every authed REST call.
	tokens *tokenCache

	// onData is the sink for incoming chat {data} messages (message-push, #112);
	// nil until SetDataHandler wires the api layer in. Guarded by mu.
	onData func(DataEvent)

	// watched is the set of topics the ROOT bot must stay subscribed to so it
	// keeps receiving their {data} (for offline-recipient push). ROOT is already
	// attached to a topic it just created this connection; watched exists so the
	// subscription is re-established after a reconnect. Guarded by watchedMu.
	watchedMu sync.Mutex
	watched   map[string]struct{}
}

// DataEvent is a chat {data} message observed on the ROOT stream: enough to
// resolve the topic's members and push the sender's message to offline ones.
// Content is the raw Drafty/JSON payload (see internal/api/message_push.go).
type DataEvent struct {
	Topic   string
	FromUID string // sender uid ("usr..."); "" for a system-originated message
	SeqID   int32
	Content []byte
}

// New constructs a Client. Call Run to start the connection loop.
func New(grpcAddr, rootLogin, rootSecret string) *Client {
	return &Client{
		addr:    grpcAddr,
		login:   rootLogin,
		secret:  rootSecret,
		pending: make(map[string]chan *pbx.ServerCtrl),
		ready:   make(chan struct{}),
		tokens:  newTokenCache(tokenCacheTTL, tokenCacheMax),
		watched: make(map[string]struct{}),
	}
}

// SetDataHandler registers the callback invoked for each incoming chat {data}
// message. It is called at most once, at startup (before Run), so it does not
// need to be safe against concurrent readers — but we guard it under mu anyway
// so the readLoop always observes a fully-published value.
func (c *Client) SetDataHandler(fn func(DataEvent)) {
	c.mu.Lock()
	c.onData = fn
	c.mu.Unlock()
}

// WatchTopic records that the ROOT bot should stay subscribed to topic so it
// receives the topic's {data} for offline-recipient push (#112). ROOT is already
// attached to a topic it created this connection; this only matters so the
// subscription survives a stream reconnect (see resubscribeWatched). Idempotent.
func (c *Client) WatchTopic(topic string) {
	if topic == "" {
		return
	}
	c.watchedMu.Lock()
	c.watched[topic] = struct{}{}
	c.watchedMu.Unlock()
}

// Rewatch records topics as watched and immediately (re)subscribes ROOT to
// them. Used at startup to re-attach to anon chats that were live before a
// restart, so their {data} resumes flowing for message-push. Best-effort.
func (c *Client) Rewatch(topics []string) {
	c.watchedMu.Lock()
	for _, t := range topics {
		if t != "" {
			c.watched[t] = struct{}{}
		}
	}
	c.watchedMu.Unlock()
	c.resubscribeWatched()
}

// resubscribeWatched re-issues {sub} for every watched topic. Called after a
// successful (re)login: on the very first login the set is empty (no topics
// created yet), so it is a no-op; after a reconnect it re-attaches ROOT to the
// anon/revealed topics created before the drop. Fire-and-forget — the ctrl
// replies are logged by the readLoop; we only need the re-attach side effect.
func (c *Client) resubscribeWatched() {
	c.watchedMu.Lock()
	topics := make([]string, 0, len(c.watched))
	for t := range c.watched {
		topics = append(topics, t)
	}
	c.watchedMu.Unlock()
	for _, t := range topics {
		id := c.nextID()
		if err := c.send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Sub{Sub: &pbx.ClientSub{Id: id, Topic: t}}}); err != nil {
			log.Printf("tinode: resubscribe %s: %v", t, err)
		}
	}
}

// dispatchData hands a chat {data} message to the registered handler, off the
// readLoop goroutine and guarded so a handler panic can never kill the stream.
// System messages (no sender) and delete markers are dropped here.
func (c *Client) dispatchData(d *pbx.ServerData) {
	if d == nil || d.FromUserId == "" || d.DeletedAt != 0 {
		return
	}
	c.mu.Lock()
	fn := c.onData
	c.mu.Unlock()
	if fn == nil {
		return
	}
	ev := DataEvent{Topic: d.Topic, FromUID: d.FromUserId, SeqID: d.SeqId, Content: d.Content}
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("tinode: data handler panic: %v", r)
			}
		}()
		fn(ev)
	}()
}

// nextID returns a process-unique request id used to correlate {ctrl} replies.
func (c *Client) nextID() string {
	return fmt.Sprintf("r%d", c.reqSeq.Add(1))
}

// WaitReady blocks until the ROOT session has authenticated or ctx is done.
func (c *Client) WaitReady(ctx context.Context) error {
	select {
	case <-c.ready:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Run dials Tinode and drives the MessageLoop until ctx is cancelled,
// reconnecting with a fixed backoff on any stream error.
func (c *Client) Run(ctx context.Context) {
	const backoff = 5 * time.Second
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		if err := c.connectAndServe(ctx); err != nil {
			log.Printf("tinode: session ended: %v; reconnecting in %s", err, backoff)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
	}
}

// connectAndServe dials, handshakes, logs in, then blocks reading the stream.
func (c *Client) connectAndServe(ctx context.Context) error {
	conn, err := grpc.NewClient(c.addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return fmt.Errorf("dial %s: %w", c.addr, err)
	}
	defer func() { _ = conn.Close() }()

	node := pbx.NewNodeClient(conn)
	stream, err := node.MessageLoop(ctx)
	if err != nil {
		return fmt.Errorf("open MessageLoop: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.stream = stream
	c.pending = make(map[string]chan *pbx.ServerCtrl) // drop any stale waiters
	c.mu.Unlock()

	// {hi} handshake.
	if err := stream.Send(&pbx.ClientMsg{
		Message: &pbx.ClientMsg_Hi{Hi: &pbx.ClientHi{
			Id:        "hi1",
			UserAgent: "anoon-companion/0.1",
			Ver:       clientVersion,
		}},
	}); err != nil {
		return fmt.Errorf("send hi: %w", err)
	}

	// {login} as ROOT using basic scheme: secret is "login:password".
	if err := stream.Send(&pbx.ClientMsg{
		Message: &pbx.ClientMsg_Login{Login: &pbx.ClientLogin{
			Id:     "login1",
			Scheme: "basic",
			Secret: []byte(c.login + ":" + c.secret),
		}},
	}); err != nil {
		return fmt.Errorf("send login: %w", err)
	}

	log.Printf("tinode: connected to %s, authenticating as ROOT %q", c.addr, c.login)
	return c.readLoop(stream)
}

// readLoop consumes server messages and dispatches them. For now it only logs
// control replies (hi/login acks) and drops the rest — real handlers come later.
func (c *Client) readLoop(stream pbx.Node_MessageLoopClient) error {
	for {
		msg, err := stream.Recv()
		if err != nil {
			return fmt.Errorf("recv: %w", err)
		}
		switch {
		case msg.GetCtrl() != nil:
			ctrl := msg.GetCtrl()
			// Mark the session ready once the ROOT login is accepted, and
			// re-attach ROOT to any topics it was watching before a reconnect so
			// their {data} keeps flowing for message-push (#112).
			if ctrl.Id == "login1" && ctrl.Code >= 200 && ctrl.Code < 300 {
				c.readyOnce.Do(func() { close(c.ready) })
				go c.resubscribeWatched()
			}
			// Route the reply to a waiting request, if any.
			c.mu.Lock()
			waiter := c.pending[ctrl.Id]
			c.mu.Unlock()
			if waiter != nil {
				waiter <- ctrl // buffered (cap 1); never blocks
			} else {
				log.Printf("tinode: ctrl id=%s code=%d text=%q", ctrl.Id, ctrl.Code, ctrl.Text)
			}
		case msg.GetData() != nil:
			// Chat message on a topic ROOT is subscribed to (anon/revealed group
			// topics — see WatchTopic). Hand it to the message-push path (#112),
			// which notifies offline recipients. Non-blocking + panic-safe.
			c.dispatchData(msg.GetData())
		case msg.GetPres() != nil:
			// TODO: presence for admin online tracking.
		case msg.GetMeta() != nil:
			// TODO: meta responses (sub lists, etc.).
		case msg.GetInfo() != nil:
			// TODO: read/recv/typing notes.
		}
	}
}

// --- request plumbing ------------------------------------------------------

// send writes one message to the stream, serialized against other senders.
func (c *Client) send(msg *pbx.ClientMsg) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()

	c.mu.Lock()
	stream := c.stream
	c.mu.Unlock()
	if stream == nil {
		return ErrNotConnected
	}
	return stream.Send(msg)
}

// request sends msg (tagged with id) and blocks for the matching {ctrl} reply,
// or until ctx is done. The caller must set the same id inside msg's payload.
func (c *Client) request(ctx context.Context, id string, msg *pbx.ClientMsg) (*pbx.ServerCtrl, error) {
	ch := make(chan *pbx.ServerCtrl, 1)

	c.mu.Lock()
	if c.stream == nil {
		c.mu.Unlock()
		return nil, ErrNotConnected
	}
	c.pending[id] = ch
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
	}()

	if err := c.send(msg); err != nil {
		return nil, err
	}

	select {
	case ctrl := <-ch:
		return ctrl, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// --- account creation ------------------------------------------------------

// CreateAccount registers a new Tinode account with the given auth scheme and
// secret (for "basic", secret is "login:password") and returns its UID
// (e.g. "usr2il9suNCR_o"). Tags make the account discoverable; pass nil for none.
//
// Registration is an *anonymous* operation, so it runs on a short-lived
// dedicated gRPC session rather than the persistent authenticated ROOT stream:
// Tinode rejects {acc user_id:"new"} on an authenticated non-root session
// (verified live — returns 500). This also means registration does not depend on
// the ROOT bot being connected or flagged via --make_root. State is left unset
// (setting it requires ROOT and new accounts default to "ok").
func (c *Client) CreateAccount(ctx context.Context, scheme string, secret []byte, tags []string) (string, error) {
	conn, err := grpc.NewClient(c.addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return "", fmt.Errorf("tinode: dial for acc: %w", err)
	}
	defer func() { _ = conn.Close() }()

	stream, err := pbx.NewNodeClient(conn).MessageLoop(ctx)
	if err != nil {
		return "", fmt.Errorf("tinode: open stream for acc: %w", err)
	}

	if err := stream.Send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Hi{Hi: &pbx.ClientHi{
		Id: "hi1", UserAgent: "anoon-companion/0.1", Ver: clientVersion,
	}}}); err != nil {
		return "", fmt.Errorf("tinode: send hi for acc: %w", err)
	}
	if err := stream.Send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Acc{Acc: &pbx.ClientAcc{
		Id: "acc1", UserId: "new", Scheme: scheme, Secret: secret, Tags: tags,
	}}}); err != nil {
		return "", fmt.Errorf("tinode: send acc: %w", err)
	}

	for {
		msg, err := stream.Recv()
		if err != nil {
			return "", fmt.Errorf("tinode: recv acc reply: %w", err)
		}
		ctrl := msg.GetCtrl()
		if ctrl == nil || ctrl.Id != "acc1" {
			continue // skip the {hi} ack and anything else
		}
		if ctrl.Code < 200 || ctrl.Code >= 300 {
			return "", fmt.Errorf("tinode: acc rejected: %d %s", ctrl.Code, ctrl.Text)
		}
		// The new UID is returned as a JSON-quoted string in params["user"].
		var uid string
		if raw := ctrl.Params["user"]; len(raw) > 0 {
			if err := json.Unmarshal(raw, &uid); err != nil {
				return "", fmt.Errorf("tinode: parse acc user id: %w", err)
			}
		}
		if uid == "" {
			return "", errors.New("tinode: acc reply missing user id")
		}
		return uid, nil
	}
}

// --- ROOT actions ----------------------------------------------------------
// These run on the persistent authenticated ROOT stream and use the
// request/{ctrl} correlation. The ROOT session must be ready (WaitReady).

// memberMode is the access mode granted to each member of an anon pair topic.
// CRITICAL (see server/ANON-PATCH.md): it must NOT include the P (presence)
// bit — with the anon patch the pair's presence is intentionally not patched,
// so granting P would leak the real UID via {pres}. The online dot is supplied
// by the companion instead. J=join R=read W=write S=share(sub self); no P/A/O/D.
const memberMode = "JRWS"

// memberModeMuted is memberMode minus the W (write) bit: a muted member keeps
// join/read/share but cannot post. Used by Mute/Unmute (see below).
const memberModeMuted = "JRS"

// memberModeRevealed is memberMode PLUS the P (presence) bit, applied to both
// members when a pair topic is revealed (no longer anonymous). Anon topics
// deliberately omit P so real presence never leaks (see memberMode); reveal is
// exactly when that hiding must end — the pair are friends now. Without P,
// Tinode broadcasts NO {pres} to the members, which suppresses both live online
// status AND message delete/edit ({pres what:"del"/"upd"}) — the root cause of
// BUG-4 (a peer's hard-delete never reaching the other side). J R W P S.
const memberModeRevealed = "JRWPS"

// CreateAnonTopic creates a group topic owned by the ROOT account, flags it
// anonymous (aux["anon"]=true, read by the server anon patch), and adds both
// real accounts as members WITHOUT the presence bit. It returns the generated
// topic name (e.g. "grpXXXXXXXX").
//
// ROOT owns the topic (not either user) precisely so neither member holds owner
// rights (which imply P). The clients {sub} the returned topic themselves.
func (c *Client) CreateAnonTopic(ctx context.Context, uidA, uidB string) (string, error) {
	// 1) Create a new group topic as ROOT.
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{Message: &pbx.ClientMsg_Sub{Sub: &pbx.ClientSub{
		Id:    id,
		Topic: "new",
	}}})
	if err != nil {
		return "", fmt.Errorf("tinode: create anon topic: %w", err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return "", fmt.Errorf("tinode: create anon topic rejected: %d %s", ctrl.Code, ctrl.Text)
	}
	// On new-topic creation Tinode returns the generated group name in the ctrl's
	// Topic field (params carries {"tmpname":"new"}); see server topic.go
	// replySubscribe (NoErrParams(id, toriginal, ...)). Fall back to params["topic"]
	// for safety.
	topic := ctrl.Topic
	if topic == "" {
		if raw := ctrl.Params["topic"]; len(raw) > 0 {
			if err := json.Unmarshal(raw, &topic); err != nil {
				return "", fmt.Errorf("tinode: parse new topic name: %w", err)
			}
		}
	}
	if topic == "" {
		return "", errors.New("tinode: new topic reply missing topic name")
	}

	// 2) Flag the topic anonymous.
	if err := c.setAnon(ctx, topic, true); err != nil {
		return "", err
	}

	// 3) Add both members without the P bit.
	if err := c.addMember(ctx, topic, uidA); err != nil {
		return "", err
	}
	if err := c.addMember(ctx, topic, uidB); err != nil {
		return "", err
	}
	return topic, nil
}

// addMember gives uid membership (modeGiven = memberMode) in topic, as ROOT.
func (c *Client) addMember(ctx context.Context, topic, uid string) error {
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{Message: &pbx.ClientMsg_Set{Set: &pbx.ClientSet{
		Id:    id,
		Topic: topic,
		Query: &pbx.SetQuery{Sub: &pbx.SetSub{UserId: uid, Mode: memberMode}},
	}}})
	if err != nil {
		return fmt.Errorf("tinode: add member %s: %w", uid, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return fmt.Errorf("tinode: add member %s rejected: %d %s", uid, ctrl.Code, ctrl.Text)
	}
	return nil
}

// setAnon sets or clears the aux["anon"] flag on a topic (ROOT {set desc}).
// The value is JSON ("true"/"false") — the server's isAnon() helper is tolerant
// of the JSON bool decoding.
func (c *Client) setAnon(ctx context.Context, topic string, anon bool) error {
	val := "false"
	if anon {
		val = "true"
	}
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{Message: &pbx.ClientMsg_Set{Set: &pbx.ClientSet{
		Id:    id,
		Topic: topic,
		Query: &pbx.SetQuery{Aux: map[string][]byte{"anon": []byte(val)}},
	}}})
	if err != nil {
		return fmt.Errorf("tinode: set anon=%v on %s: %w", anon, topic, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return fmt.Errorf("tinode: set anon=%v on %s rejected: %d %s", anon, topic, ctrl.Code, ctrl.Text)
	}
	return nil
}

// Reveal turns an anonymous pair topic into a normal friend chat: it lifts the
// aux["anon"] flag (server ANON-PATCH stops blanking From/peer, history intact)
// AND grants both members the P (presence) bit they were withheld while anon.
// Granting P is what makes Tinode broadcast {pres} to the pair again — live
// online status and, crucially, message delete/edit ({pres what:"del"/"upd"}),
// so a revealed friend's hard-delete now reaches the other side (BUG-4).
//
// uidA/uidB are the two members' Tinode UIDs. The effective access mode is
// modeGiven & modeWant, so P must be present in BOTH: we grant it in modeGiven
// as ROOT, and best-effort bump each member's own modeWant to include it too
// (on_behalf_of), covering a client that subscribed with a want lacking P.
func (c *Client) Reveal(ctx context.Context, topic, uidA, uidB string) error {
	if err := c.setAnon(ctx, topic, false); err != nil {
		return err
	}
	for _, uid := range []string{uidA, uidB} {
		if uid == "" {
			continue
		}
		// modeGiven: required — this is the actual fix. A failure means presence
		// (and thus del/edit) would stay suppressed, so surface it.
		if err := c.setMemberMode(ctx, topic, uid, memberModeRevealed); err != nil {
			return fmt.Errorf("tinode: grant presence (given) to %s on %s: %w", uid, topic, err)
		}
		// modeWant: best-effort insurance. Tinode's group default want already
		// includes P, so given alone usually suffices; this only matters if a
		// client subscribed with a P-less want. Don't fail the reveal on it.
		if err := c.setMemberWant(ctx, topic, uid, memberModeRevealed); err != nil {
			log.Printf("tinode: grant presence (want) to %s on %s failed (non-fatal): %v", uid, topic, err)
		}
	}
	return nil
}

// setMemberWant sets a member's OWN modeWant on a topic (as opposed to
// setMemberMode, which sets modeGiven for another user). Tinode treats a
// {set sub} with no user id as the caller updating their own want, so we issue
// it on_behalf_of uid (ROOT impersonation, same mechanism as CreateP2P).
func (c *Client) setMemberWant(ctx context.Context, topic, uid, mode string) error {
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{
		Message: &pbx.ClientMsg_Set{Set: &pbx.ClientSet{
			Id:    id,
			Topic: topic,
			Query: &pbx.SetQuery{Sub: &pbx.SetSub{Mode: mode}}, // no UserId => self (modeWant)
		}},
		Extra: &pbx.ClientExtra{OnBehalfOf: uid, AuthLevel: pbx.AuthLevel_ROOT},
	})
	if err != nil {
		return fmt.Errorf("tinode: set want %q for %s in %s: %w", mode, uid, topic, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return fmt.Errorf("tinode: set want for %s in %s rejected: %d %s", uid, topic, ctrl.Code, ctrl.Text)
	}
	return nil
}

// CreateP2P opens a peer-to-peer chat between two real accounts by subscribing
// uidA to topic uidB on_behalf_of uidA (ROOT impersonation). Used for friend
// links established via #ID search / invite (reveal reuses the existing topic).
func (c *Client) CreateP2P(ctx context.Context, uidA, uidB string) error {
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{
		Message: &pbx.ClientMsg_Sub{Sub: &pbx.ClientSub{Id: id, Topic: uidB}},
		Extra:   &pbx.ClientExtra{OnBehalfOf: uidA, AuthLevel: pbx.AuthLevel_ROOT},
	})
	if err != nil {
		return fmt.Errorf("tinode: create p2p %s-%s: %w", uidA, uidB, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return fmt.Errorf("tinode: create p2p rejected: %d %s", ctrl.Code, ctrl.Text)
	}
	return nil
}

// ResolveToken validates a Tinode auth token by logging into a short-lived
// dedicated session with scheme "token" and returns the associated UID
// (from ctrl.params["user"]). This is how the companion authenticates its own
// REST/WS callers: the frontend presents the Tinode login token it already
// holds. Runs off the persistent ROOT stream so it never blocks it.
func (c *Client) ResolveToken(ctx context.Context, token string) (string, error) {
	// Fast path: a recently validated token skips the gRPC round-trip entirely.
	// Only successful resolutions are cached, so invalid/revoked tokens still
	// re-validate every call; a token revoked after caching stops working within
	// tokenCacheTTL at worst.
	if uid, ok := c.tokens.get(token); ok {
		return uid, nil
	}

	// The token as handed to us (and as the frontend holds it, e.g. from
	// Tinode's own `ctrl.params.token`) is base64 text — that's how it travels
	// over the WS/JSON protocol, where Go's `encoding/json` auto-decodes a
	// `[]byte` field like `ClientLogin.Secret` from its base64 string form.
	// gRPC's `bytes` field gets no such implicit decoding, so we do it
	// ourselves here to hand Authenticate() the same raw bytes either path.
	secret, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return "", fmt.Errorf("tinode: invalid token encoding: %w", err)
	}

	conn, err := grpc.NewClient(c.addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return "", fmt.Errorf("tinode: dial for token: %w", err)
	}
	defer func() { _ = conn.Close() }()

	stream, err := pbx.NewNodeClient(conn).MessageLoop(ctx)
	if err != nil {
		return "", fmt.Errorf("tinode: open stream for token: %w", err)
	}
	if err := stream.Send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Hi{Hi: &pbx.ClientHi{
		Id: "hi1", UserAgent: "anoon-companion/0.1", Ver: clientVersion,
	}}}); err != nil {
		return "", fmt.Errorf("tinode: send hi for token: %w", err)
	}
	if err := stream.Send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Login{Login: &pbx.ClientLogin{
		Id: "login1", Scheme: "token", Secret: secret,
	}}}); err != nil {
		return "", fmt.Errorf("tinode: send token login: %w", err)
	}

	for {
		msg, err := stream.Recv()
		if err != nil {
			return "", fmt.Errorf("tinode: recv token reply: %w", err)
		}
		ctrl := msg.GetCtrl()
		if ctrl == nil || ctrl.Id != "login1" {
			continue
		}
		if ctrl.Code < 200 || ctrl.Code >= 300 {
			return "", fmt.Errorf("tinode: token rejected: %d %s", ctrl.Code, ctrl.Text)
		}
		var uid string
		if raw := ctrl.Params["user"]; len(raw) > 0 {
			if err := json.Unmarshal(raw, &uid); err != nil {
				return "", fmt.Errorf("tinode: parse token user id: %w", err)
			}
		}
		if uid == "" {
			return "", errors.New("tinode: token reply missing user id")
		}
		c.tokens.put(token, uid)
		return uid, nil
	}
}

// InvalidateToken drops any cached token→uid mapping so the next ResolveToken
// for it re-validates against Tinode. Wire this to a logout / token-revocation
// path; the tokenCacheTTL expiry handles revocation otherwise.
func (c *Client) InvalidateToken(token string) {
	c.tokens.invalidate(token)
}

// Ban suspends a user account by setting its Tinode state to "susp" via a ROOT
// {acc} on the persistent authenticated stream. A suspended account cannot log
// in and its live sessions are dropped by the server. Unban restores "ok".
//
// This is an existing-account update (UserId is the target uid, not "new"), so
// unlike CreateAccount it runs on the ROOT stream — changing another account's
// state is a ROOT-only operation.
func (c *Client) Ban(ctx context.Context, uid string) error {
	return c.setAccountState(ctx, uid, "susp")
}

// Unban clears a suspension, returning the account to normal ("ok") state.
func (c *Client) Unban(ctx context.Context, uid string) error {
	return c.setAccountState(ctx, uid, "ok")
}

// DeleteAccount soft-deletes a Tinode account via a ROOT {acc user_id:uid
// state:"del"}. It exists to compensate for a half-completed registration: if
// the Tinode account was created but the companion #ID mapping then failed, the
// account is an orphan and must not be left dangling. Callers that cannot reach
// the ROOT stream should fall back to Ban (suspend) and log for reconciliation.
func (c *Client) DeleteAccount(ctx context.Context, uid string) error {
	return c.setAccountState(ctx, uid, "del")
}

// setAccountState issues a ROOT {acc user_id:uid state:...} and awaits the ctrl.
func (c *Client) setAccountState(ctx context.Context, uid, state string) error {
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{Message: &pbx.ClientMsg_Acc{Acc: &pbx.ClientAcc{
		Id:     id,
		UserId: uid,
		State:  state,
	}}})
	if err != nil {
		return fmt.Errorf("tinode: set state=%s on %s: %w", state, uid, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return fmt.Errorf("tinode: set state=%s on %s rejected: %d %s", state, uid, ctrl.Code, ctrl.Text)
	}
	return nil
}

// SetBasicPassword resets a user's basic-scheme secret to "login:newPassword"
// as ROOT (password reset, #116). login must be the account's existing basic
// username — Tinode keys the auth record by it — so callers pass the login
// companion stored at registration (store.BasicLogin). Runs on the persistent
// ROOT stream: changing another account's auth record is a ROOT operation.
func (c *Client) SetBasicPassword(ctx context.Context, uid, login, newPassword string) error {
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{Message: &pbx.ClientMsg_Acc{Acc: &pbx.ClientAcc{
		Id:     id,
		UserId: uid,
		Scheme: "basic",
		Secret: []byte(login + ":" + newPassword),
	}}})
	if err != nil {
		return fmt.Errorf("tinode: set password for %s: %w", uid, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return fmt.Errorf("tinode: set password for %s rejected: %d %s", uid, ctrl.Code, ctrl.Text)
	}
	return nil
}

// Mute drops a user's W (write) right in a topic by re-granting membership
// without the W bit (ROOT {set sub}), so they can still read/receive but not
// post. Unmute restores the full member mode.
//
// NOTE: account-wide muting is enforced by companion via users.mute_until (see
// store.MuteUser / the roulette enqueue guard) — that is the source of truth,
// because a mute spans every topic. This per-topic W-drop is the Tinode-side
// hard stop for an *active* chat the muted user is currently in; the companion
// calls it for the offending topic while mute_until covers everything else.
func (c *Client) Mute(ctx context.Context, uid, topic string) error {
	return c.setMemberMode(ctx, topic, uid, memberModeMuted)
}

// Unmute restores the user's full member mode (including W) in the topic.
func (c *Client) Unmute(ctx context.Context, uid, topic string) error {
	return c.setMemberMode(ctx, topic, uid, memberMode)
}

// setMemberMode sets uid's granted access mode in topic (ROOT {set sub}).
func (c *Client) setMemberMode(ctx context.Context, topic, uid, mode string) error {
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{Message: &pbx.ClientMsg_Set{Set: &pbx.ClientSet{
		Id:    id,
		Topic: topic,
		Query: &pbx.SetQuery{Sub: &pbx.SetSub{UserId: uid, Mode: mode}},
	}}})
	if err != nil {
		return fmt.Errorf("tinode: set mode %q for %s in %s: %w", mode, uid, topic, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 300 {
		return fmt.Errorf("tinode: set mode for %s in %s rejected: %d %s", uid, topic, ctrl.Code, ctrl.Text)
	}
	return nil
}
