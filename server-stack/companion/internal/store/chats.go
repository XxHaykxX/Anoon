package store

// chats.go holds companion's half of the admin "Чаты" section
// (COMPANION-ADMIN-API.md §3). The conversations themselves live in Tinode
// topics (see internal/tinode/chats.go); what companion owns is who the two
// people behind a topic are, which of their attachments are still live, and the
// journal entry recording that a moderator read them.

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// ChatRow is one roulette pairing as the admin chat list wants it: the Tinode
// topic backing the conversation plus both members, with their #IDs
// denormalized so the handler needs no second lookup.
type ChatRow struct {
	Topic     string
	Status    string
	AID       int64
	AHash     int64
	BID       int64
	BHash     int64
	CreatedAt time.Time
}

// ListChats returns the most recent pairings, newest first. Every status is
// included — an ended or revealed chat is as much a moderation subject as a
// live one, and the panel sorts by last activity anyway.
func (s *Store) ListChats(ctx context.Context, limit int) ([]ChatRow, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.topic, m.status, m.user_a, ua.hash_id, m.user_b, ub.hash_id, m.created_at
		FROM roulette_matches m
		JOIN users ua ON ua.id = m.user_a
		JOIN users ub ON ub.id = m.user_b
		ORDER BY m.created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list chats: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := []ChatRow{}
	for rows.Next() {
		var c ChatRow
		if err := rows.Scan(&c.Topic, &c.Status, &c.AID, &c.AHash, &c.BID, &c.BHash, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: scan chat: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// MediaByTopic maps a conversation's still-live attachment refs to their kind,
// so the chat viewer resolves a message's attachment through the same registry
// the Files/Gallery sections read (§4) — which also means an asset a moderator
// soft-deleted stops rendering here too, instead of living on inside the chat.
func (s *Store) MediaByTopic(ctx context.Context, topic string) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT url, kind FROM media_assets
		WHERE topic = $1 AND deleted_at IS NULL`, topic)
	if err != nil {
		return nil, fmt.Errorf("store: media by topic: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := map[string]string{}
	for rows.Next() {
		var url, kind string
		if err := rows.Scan(&url, &kind); err != nil {
			return nil, fmt.Errorf("store: scan media ref: %w", err)
		}
		out[url] = kind
	}
	return out, rows.Err()
}

// LogChatView records that a moderator opened a conversation. Reading two
// people's private messages is a moderation act like any other, so it lands in
// the same append-only journal as ban/mute/media_delete (migration 0004).
//
// Both members go into meta rather than target_user_id: the act is about a pair,
// and naming one of them "the target" would be an arbitrary half-truth in the
// one record that is supposed to be evidence.
func (s *Store) LogChatView(ctx context.Context, moderatorID, topic string, userA, userB int64) error {
	meta, err := json.Marshal(map[string]any{"topic": topic, "members": []int64{userA, userB}})
	if err != nil {
		return fmt.Errorf("store: chat view meta: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO moderator_actions (moderator_id, action_type, meta)
		VALUES ($1, 'view_chat', $2::jsonb)`, nullString(moderatorID), string(meta)); err != nil {
		return fmt.Errorf("store: chat view log: %w", err)
	}
	return nil
}
