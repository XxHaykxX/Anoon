package tinode

// chats.go is the ROOT bot's read side: list the topics it sits in, and read one
// topic's history. It backs the admin "Чаты" section (COMPANION-ADMIN-API.md §3
// — a moderator sees a reported conversation whole, per the owner's decision on
// Q7a). Everything else in this package acts on Tinode; this is the only part
// that reads back.
//
// What it adds to client.go's request/{ctrl} correlation is collection of the
// {meta} and {data} frames a Tinode {get} answers with:
//
//   - {meta} carries the request id, so it routes like a {ctrl}. A meta-only get
//     is answered with EITHER the meta OR a {ctrl} (204 empty / an error), never
//     both — see the server's replyGetSub — so getMeta waits on whichever lands.
//   - {data} carries no request id and is routed by topic. A data get IS closed
//     by a {ctrl} (208 delivered / 204 empty), which is what bounds collection.
//
// Routing history {data} by topic is also why a read suppresses the live
// message-push dispatch for that topic while it runs (collectData returning true
// in readLoop): replaying a conversation through onTinodeData would push every
// one of those old messages at the two participants.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"time"

	"anoon/companion/internal/pbx"
)

// maxTopics / maxMessages bound one admin read. Both are far above what the
// panel shows; they exist so a runaway topic cannot pull an unbounded history
// through the single ROOT stream.
const (
	maxTopics   = 500
	maxMessages = 500
)

// TopicInfo is one topic the ROOT bot is subscribed to.
type TopicInfo struct {
	Topic string
	// SeqID is Tinode's per-topic message counter, i.e. how many messages the
	// topic has ever carried (deletions do not rewind it).
	SeqID int
	// TouchedAt is the topic's last activity; zero when it has none.
	TouchedAt time.Time
}

// Message is one {data} frame of a topic's history, flattened.
//
// FromUID is EMPTY while a topic is anonymous: the anon patch blanks the sender
// for every session, ROOT included (server/server/topic.go — replyGetData and
// prepareBroadcastableMessage both key off Topic.isAnon), so Tinode does not
// tell us who wrote what until the pair reveals. Callers must read "" as
// "unknown", never as "sent by the system".
type Message struct {
	SeqID     int
	FromUID   string
	Timestamp time.Time
	Content   []byte // raw Drafty/JSON payload; decoding it is the api layer's job
}

// Topics lists the topics the ROOT bot is subscribed to, touched after `since`.
// ROOT owns every anon pair topic it creates (CreateAnonTopic) and stays in it
// after a reveal, so this is the roulette conversation history — one round trip
// for all of it, rather than a {get desc} per topic.
//
// `since` is not an optimization, it is what makes the answer correct. Tinode's
// subscription query for `me` has no ORDER BY (server/db/postgres/adapter.go,
// TopicsForUser), so a plain limited get returns an ARBITRARY slice of ROOT's
// subscriptions — on this stand, 498 topics from July, none of them the ones the
// panel was about to show. Passing `if_modified_since` switches the server onto
// its cache path, which drops the limit and filters by `topics.touchedat`
// instead: every topic active since that moment, which is exactly the set the
// caller is joining against. A zero `since` keeps the bounded-but-arbitrary
// behaviour and is only useful for a smoke check.
//
// ponytail: p2p friend topics (usrXXX) are absent — ROOT is not a member of one
// and cannot attach to it by name (see message_push.go's header for why we do
// not make it one). Friend chats would need a per-user {get me} pass.
func (c *Client) Topics(ctx context.Context, since time.Time) ([]TopicInfo, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()

	// ROOT's own `me` topic lists its subscriptions. Attach, read, leave: staying
	// attached would stream every {pres} of every topic ROOT is in down the hot
	// stream for nothing.
	//
	// ponytail: attaching still costs one {pres} burst proportional to ROOT's
	// subscription count, and the panel polls the list every 10s. Cache the
	// result behind a short TTL if that burst ever shows up in the ROOT stream.
	if err := c.attach(ctx, "me"); err != nil {
		return nil, err
	}
	defer c.detach("me")

	opts := &pbx.GetOpts{Limit: maxTopics}
	if !since.IsZero() {
		opts.IfModifiedSince = since.UnixMilli()
	}
	meta, err := c.getMeta(ctx, "me", &pbx.GetQuery{What: "sub", Sub: opts})
	if err != nil {
		return nil, err
	}

	out := make([]TopicInfo, 0, len(meta.GetSub()))
	for _, sub := range meta.GetSub() {
		if sub.GetTopic() == "" || sub.GetDeletedAt() != 0 {
			continue
		}
		out = append(out, TopicInfo{
			Topic:     sub.GetTopic(),
			SeqID:     int(sub.GetSeqId()),
			TouchedAt: msTime(sub.GetTouchedAt()),
		})
	}
	return out, nil
}

// Messages reads the last `limit` messages of one topic as ROOT, oldest first.
func (c *Client) Messages(ctx context.Context, topic string, limit int) ([]Message, error) {
	if topic == "" {
		return nil, errors.New("tinode: empty topic")
	}
	if limit <= 0 || limit > maxMessages {
		limit = maxMessages
	}
	c.readMu.Lock()
	defer c.readMu.Unlock()

	if err := c.attach(ctx, topic); err != nil {
		return nil, err
	}
	// Only leave a topic we are not otherwise meant to be in. Leaving a watched
	// one would silently stop message-push for a live chat (#112) until the next
	// reconnect — a moderator opening a conversation must not cost its
	// participants their notifications.
	if !c.isWatched(topic) {
		defer c.detach(topic)
	}

	// ponytail: for the duration of the read, live {data} on this topic is
	// collected as history instead of reaching message-push — a message sent in
	// exactly that round trip loses its push notification. Tagging history frames
	// would need a marker Tinode does not send; a moderator opening a chat is
	// rare enough that the trade is a one-in-a-million missed notification.
	frames, err := c.getData(ctx, topic, limit)
	if err != nil {
		return nil, err
	}

	out := make([]Message, 0, len(frames))
	for _, d := range frames {
		if d.GetDeletedAt() != 0 {
			continue
		}
		out = append(out, Message{
			SeqID:     int(d.GetSeqId()),
			FromUID:   d.GetFromUserId(),
			Timestamp: msTime(d.GetTimestamp()),
			Content:   d.GetContent(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SeqID < out[j].SeqID })
	return out, nil
}

// --- attach / detach --------------------------------------------------------

// attach subscribes the ROOT session to topic, which is what makes {get} legal
// on it. A second {sub} for a topic this session already holds answers 304
// ("already subscribed") — a success here, and the normal case for the live anon
// topics ROOT stays attached to for message-push.
func (c *Client) attach(ctx context.Context, topic string) error {
	id := c.nextID()
	ctrl, err := c.request(ctx, id, &pbx.ClientMsg{Message: &pbx.ClientMsg_Sub{Sub: &pbx.ClientSub{
		Id:    id,
		Topic: topic,
	}}})
	if err != nil {
		return fmt.Errorf("tinode: attach %s: %w", topic, err)
	}
	if ctrl.Code < 200 || ctrl.Code >= 400 {
		return fmt.Errorf("tinode: attach %s rejected: %d %s", topic, ctrl.Code, ctrl.Text)
	}
	return nil
}

// detach leaves a topic WITHOUT unsubscribing (unsub=false): ROOT owns the anon
// topics and must keep its membership. Fire-and-forget — nothing depends on the
// reply, and a failure only leaves the session attached.
func (c *Client) detach(topic string) {
	id := c.nextID()
	if err := c.send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Leave{Leave: &pbx.ClientLeave{
		Id:    id,
		Topic: topic,
	}}}); err != nil {
		log.Printf("tinode: leave %s: %v", topic, err)
	}
}

// isWatched reports whether the ROOT bot must stay subscribed to topic for
// message-push (see WatchTopic).
func (c *Client) isWatched(topic string) bool {
	c.watchedMu.Lock()
	defer c.watchedMu.Unlock()
	_, ok := c.watched[topic]
	return ok
}

// --- {get} plumbing ---------------------------------------------------------

// getMeta issues a {get} whose answer is a single {meta} frame and returns it.
// A 204 ("no content") reply is not an error — it is the empty answer — so the
// returned meta may be nil; the accessors on it are nil-safe.
func (c *Client) getMeta(ctx context.Context, topic string, q *pbx.GetQuery) (*pbx.ServerMeta, error) {
	id := c.nextID()
	metaCh := make(chan *pbx.ServerMeta, 1)
	ctrlCh := make(chan *pbx.ServerCtrl, 1)

	c.mu.Lock()
	if c.stream == nil {
		c.mu.Unlock()
		return nil, ErrNotConnected
	}
	c.metaSink[id] = metaCh
	c.pending[id] = ctrlCh
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.metaSink, id)
		delete(c.pending, id)
		c.mu.Unlock()
	}()

	if err := c.send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Get{Get: &pbx.ClientGet{
		Id: id, Topic: topic, Query: q,
	}}}); err != nil {
		return nil, fmt.Errorf("tinode: get %s %s: %w", topic, q.GetWhat(), err)
	}

	select {
	case m := <-metaCh:
		return m, nil
	case ctrl := <-ctrlCh:
		if ctrl.Code < 200 || ctrl.Code >= 300 {
			return nil, fmt.Errorf("tinode: get %s %s rejected: %d %s", topic, q.GetWhat(), ctrl.Code, ctrl.Text)
		}
		return nil, nil // 204: the answer is "nothing"
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// getData issues a {get what:"data"} and returns the history frames it produced.
// Unlike a meta get this one IS terminated by a {ctrl} carrying the request id,
// so the ctrl is the signal that every frame has arrived.
func (c *Client) getData(ctx context.Context, topic string, limit int) ([]*pbx.ServerData, error) {
	id := c.nextID()
	ctrlCh := make(chan *pbx.ServerCtrl, 1)
	frames := &[]*pbx.ServerData{}

	c.mu.Lock()
	if c.stream == nil {
		c.mu.Unlock()
		return nil, ErrNotConnected
	}
	c.dataSink[topic] = frames
	c.pending[id] = ctrlCh
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.dataSink, topic)
		delete(c.pending, id)
		c.mu.Unlock()
	}()

	if err := c.send(&pbx.ClientMsg{Message: &pbx.ClientMsg_Get{Get: &pbx.ClientGet{
		Id: id, Topic: topic,
		Query: &pbx.GetQuery{What: "data", Data: &pbx.GetOpts{Limit: int32(limit)}},
	}}}); err != nil {
		return nil, fmt.Errorf("tinode: get %s data: %w", topic, err)
	}

	select {
	case ctrl := <-ctrlCh:
		if ctrl.Code < 200 || ctrl.Code >= 300 {
			return nil, fmt.Errorf("tinode: get %s data rejected: %d %s", topic, ctrl.Code, ctrl.Text)
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	c.mu.Lock()
	out := *frames
	c.mu.Unlock()
	return out, nil
}

// collectMeta hands a {meta} to the reader waiting on its request id, if any.
// Extra frames for the same id are dropped rather than blocking the read loop.
func (c *Client) collectMeta(m *pbx.ServerMeta) {
	c.mu.Lock()
	ch := c.metaSink[m.GetId()]
	c.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- m:
	default:
	}
}

// collectData appends a {data} frame to the history read in progress on its
// topic and reports whether it did. True means the frame was history and must
// NOT also be treated as a live message (see readLoop).
func (c *Client) collectData(d *pbx.ServerData) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	sink := c.dataSink[d.GetTopic()]
	if sink == nil {
		return false
	}
	*sink = append(*sink, d)
	return true
}

// msTime converts a Tinode millisecond timestamp to a time.Time, mapping 0 (the
// protobuf zero value, i.e. "absent") to the zero time rather than 1970.
func msTime(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}
