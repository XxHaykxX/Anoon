package store

// media.go persists the media_assets registry (migration 0004_moderation.sql,
// see its doc comment): a reference to every image/video/audio asset exchanged
// in a chat, powering the admin Files/Gallery sections and the view-once/
// report-escalation lifecycle (COMPANION-ADMIN-API.md §4). The physical bytes
// live wherever Tinode's upload handler put them — this table only tracks the
// reference + moderation metadata (ephemeral/expires_at/deleted_at/escalated).

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// validMediaKind is the closed set the media_assets table CHECK enforces; we
// reject early so a bad kind is a 400, not a 500 from the DB constraint.
var validMediaKind = map[string]bool{"image": true, "video": true, "audio": true}

// ValidMediaKind reports whether kind is one of image|video|audio.
func ValidMediaKind(kind string) bool { return validMediaKind[kind] }

// MediaAssetRow is one media_assets row, returned both to the uploading user
// (POST /media) and the admin Files/Gallery API (§4). OwnerBadge is
// denormalized from the joined user so the admin UI needs no extra lookup.
// Mime/Size (migration 0007_media_assets.sql) are optional on CreateMediaAsset
// — callers that don't pass them get "" / 0.
type MediaAssetRow struct {
	ID         int64      `json:"id"`
	OwnerID    int64      `json:"ownerProfileId"`
	OwnerBadge string     `json:"ownerBadge"`
	Topic      string     `json:"topic"`
	Kind       string     `json:"kind"`
	URL        string     `json:"url"`
	Mime       string     `json:"mime"`
	Size       int64      `json:"size"`
	Ephemeral  bool       `json:"ephemeral"`
	ExpiresAt  *time.Time `json:"expiresAt"`
	DeletedAt  *time.Time `json:"deletedAt"`
	Escalated  bool       `json:"escalated"`
	CreatedAt  time.Time  `json:"createdAt"`
}

const mediaSelect = `
	SELECT m.id, m.owner_id, u.hash_id, COALESCE(m.topic, ''), m.kind, m.url,
	       COALESCE(m.mime, ''), COALESCE(m.size, 0),
	       m.ephemeral, m.expires_at, m.deleted_at, m.escalated, m.created_at
	FROM media_assets m
	JOIN users u ON u.id = m.owner_id`

func scanMediaAsset(sc interface{ Scan(...any) error }) (MediaAssetRow, error) {
	var row MediaAssetRow
	var hash int64
	var expires, deleted sql.NullTime
	if err := sc.Scan(&row.ID, &row.OwnerID, &hash, &row.Topic, &row.Kind, &row.URL,
		&row.Mime, &row.Size,
		&row.Ephemeral, &expires, &deleted, &row.Escalated, &row.CreatedAt); err != nil {
		return MediaAssetRow{}, err
	}
	row.OwnerBadge = FormatHashID(hash)
	if expires.Valid {
		t := expires.Time
		row.ExpiresAt = &t
	}
	if deleted.Valid {
		t := deleted.Time
		row.DeletedAt = &t
	}
	return row, nil
}

// insertMediaAsset is the shared insert behind CreateMediaAsset. topic may be
// empty (asset not tied to a chat topic, e.g. a profile avatar); mime/size may
// be empty/0 when the caller doesn't have them.
func (s *Store) insertMediaAsset(ctx context.Context, ownerID int64, topic, kind, url, mime string, size int64, ephemeral bool, expiresAt *time.Time) (MediaAssetRow, error) {
	var topicVal, mimeVal sql.NullString
	if topic != "" {
		topicVal = sql.NullString{String: topic, Valid: true}
	}
	if mime != "" {
		mimeVal = sql.NullString{String: mime, Valid: true}
	}
	var sizeVal sql.NullInt64
	if size > 0 {
		sizeVal = sql.NullInt64{Int64: size, Valid: true}
	}
	var expiresVal sql.NullTime
	if expiresAt != nil {
		expiresVal = sql.NullTime{Time: *expiresAt, Valid: true}
	}

	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO media_assets (owner_id, topic, kind, url, mime, size, ephemeral, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id`,
		ownerID, topicVal, kind, url, mimeVal, sizeVal, ephemeral, expiresVal,
	).Scan(&id)
	if err != nil {
		return MediaAssetRow{}, fmt.Errorf("store: insert media asset: %w", err)
	}
	return s.GetMediaAsset(ctx, id)
}

// CreateMediaAsset records one uploaded media reference (POST /media): kind is
// caller-supplied (validate with ValidMediaKind first), with an optional
// view-once (ephemeral/expiresAt) lifecycle for #88. It returns the created
// row.
func (s *Store) CreateMediaAsset(ctx context.Context, ownerID int64, topic, kind, url string, ephemeral bool, expiresAt *time.Time) (MediaAssetRow, error) {
	return s.insertMediaAsset(ctx, ownerID, topic, kind, url, "", 0, ephemeral, expiresAt)
}

// GetMediaAsset loads a single media_assets row (used to echo a created/patched
// asset back).
func (s *Store) GetMediaAsset(ctx context.Context, id int64) (MediaAssetRow, error) {
	row, err := scanMediaAsset(s.db.QueryRowContext(ctx, mediaSelect+" WHERE m.id = $1", id))
	if err != nil {
		return MediaAssetRow{}, fmt.Errorf("store: get media asset %d: %w", id, err)
	}
	return row, nil
}

// MediaListParams filters the admin Files/Gallery listing (§4): ownerId=0
// means any owner (the "all" gallery view); Kind/From/To are optional.
type MediaListParams struct {
	OwnerID int64
	Kind    string
	From    *time.Time
	To      *time.Time
	Offset  int
	Limit   int
}

// ListMediaAssets returns a page of media_assets rows (newest first) plus the
// total (pre-pagination) count, honoring OwnerID/Kind/From/To. Soft-deleted
// rows are included (deletedAt is emitted so the UI can show "deleted") since
// the admin gallery is the moderation view, not the user-facing one.
func (s *Store) ListMediaAssets(ctx context.Context, p MediaListParams) ([]MediaAssetRow, int, error) {
	var where []string
	var args []any
	i := 1

	if p.OwnerID > 0 {
		where = append(where, fmt.Sprintf("m.owner_id = $%d", i))
		args = append(args, p.OwnerID)
		i++
	}
	if p.Kind != "" {
		where = append(where, fmt.Sprintf("m.kind = $%d", i))
		args = append(args, p.Kind)
		i++
	}
	if p.From != nil {
		where = append(where, fmt.Sprintf("m.created_at >= $%d", i))
		args = append(args, *p.From)
		i++
	}
	if p.To != nil {
		where = append(where, fmt.Sprintf("m.created_at <= $%d", i))
		args = append(args, *p.To)
		i++
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := s.db.QueryRowContext(ctx,
		"SELECT count(*) FROM media_assets m "+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("store: count media assets: %w", err)
	}

	limit := p.Limit
	if limit <= 0 || limit > 500 {
		limit = 25
	}
	q := mediaSelect + " " + whereSQL + " ORDER BY m.created_at DESC" +
		fmt.Sprintf(" LIMIT $%d OFFSET $%d", i, i+1)
	args = append(args, limit, p.Offset)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("store: list media assets: %w", err)
	}
	defer rows.Close()

	out := make([]MediaAssetRow, 0, limit)
	for rows.Next() {
		row, err := scanMediaAsset(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("store: scan media asset: %w", err)
		}
		out = append(out, row)
	}
	return out, total, rows.Err()
}

// MediaFolderRow is one admin "Files" folder row (§4 GET /admin/media/folders):
// a per-owner rollup of non-deleted asset counts by kind.
type MediaFolderRow struct {
	OwnerID  int64  `json:"profileId"`
	PublicID string `json:"publicId"`
	Nickname string `json:"nickname"`
	Images   int    `json:"images"`
	Videos   int    `json:"videos"`
	// Audios are the voice messages. Counted separately because the admin panel
	// renders them with a player rather than an <img>; without this the folder's
	// per-kind numbers silently fail to add up to Count, which is every kind.
	Audios int `json:"audios"`
	Count  int `json:"count"`
}

// ListMediaFolders groups non-deleted media_assets by owner, for the admin
// Files section's folder view.
func (s *Store) ListMediaFolders(ctx context.Context) ([]MediaFolderRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.owner_id, u.hash_id,
		       count(*) FILTER (WHERE m.kind = 'image'),
		       count(*) FILTER (WHERE m.kind = 'video'),
		       count(*) FILTER (WHERE m.kind = 'audio'),
		       count(*)
		FROM media_assets m
		JOIN users u ON u.id = m.owner_id
		WHERE m.deleted_at IS NULL
		GROUP BY m.owner_id, u.hash_id
		ORDER BY count(*) DESC`)
	if err != nil {
		return nil, fmt.Errorf("store: list media folders: %w", err)
	}
	defer rows.Close()

	var out []MediaFolderRow
	for rows.Next() {
		var f MediaFolderRow
		var hash int64
		if err := rows.Scan(&f.OwnerID, &hash, &f.Images, &f.Videos, &f.Audios, &f.Count); err != nil {
			return nil, fmt.Errorf("store: scan media folder: %w", err)
		}
		f.PublicID = PadHashID(hash)
		f.Nickname = FormatHashID(hash)
		out = append(out, f)
	}
	return out, rows.Err()
}

// EscalateMediaByTopic flags every non-deleted media_assets row in topic as
// escalated, so the view-once/TTL cleanup path never purges it before a
// moderator has reviewed the report that references it. Called from
// POST /reports for a roulette (grpXXX) topic — one name, shared by both
// members and unique to the pairing, so it selects exactly that conversation.
// A no-op (not an error) when topic is empty or matches nothing.
//
// Not for Tinode p2p topics: their names are per-user, so `usrB` is not one
// conversation but every chat anyone has with B. Use EscalateMediaByTopicOwner.
func (s *Store) EscalateMediaByTopic(ctx context.Context, topic string) error {
	if topic == "" {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE media_assets SET escalated = true
		WHERE topic = $1 AND escalated = false`, topic); err != nil {
		return fmt.Errorf("store: escalate media for topic %q: %w", topic, err)
	}
	return nil
}

// EscalateMediaByTopicOwner is EscalateMediaByTopic narrowed to one owner. It
// exists for Tinode p2p friend topics, whose names are per-user: the chat A
// sees as `usrB` is the one B sees as `usrA`, and each side files its own media
// under the name it uses. Escalating a p2p conversation is therefore two
// owner-scoped passes — (their uid, my rows) and (my uid, their rows) — rather
// than one topic-wide pass, which would sweep in every other chat with the same
// peer while still missing the reported user's own media.
func (s *Store) EscalateMediaByTopicOwner(ctx context.Context, topic string, ownerID int64) error {
	if topic == "" || ownerID == 0 {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE media_assets SET escalated = true
		WHERE topic = $1 AND owner_id = $2 AND escalated = false`, topic, ownerID); err != nil {
		return fmt.Errorf("store: escalate media for topic %q owner %d: %w", topic, ownerID, err)
	}
	return nil
}

// SoftDeleteMediaAsset marks a media_assets row deleted (deleted_at = now())
// and appends a moderator_actions entry attributed to moderatorID. It is
// idempotent: deleting an already-deleted asset is a harmless no-op. Returns
// the updated row.
func (s *Store) SoftDeleteMediaAsset(ctx context.Context, id int64, moderatorID string) (MediaAssetRow, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MediaAssetRow{}, fmt.Errorf("store: begin media delete tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var ownerID int64
	if err := tx.QueryRowContext(ctx, `
		UPDATE media_assets SET deleted_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING owner_id`, id).Scan(&ownerID); err != nil {
		if err == sql.ErrNoRows {
			// Either the id doesn't exist or it's already deleted; either way,
			// there is nothing further to do — let the caller's follow-up
			// GetMediaAsset surface a not-found if the id is bogus.
			return s.GetMediaAsset(ctx, id)
		}
		return MediaAssetRow{}, fmt.Errorf("store: soft-delete media asset %d: %w", id, err)
	}

	meta := fmt.Sprintf(`{"mediaId": %d}`, id)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderator_actions (moderator_id, action_type, target_user_id, meta)
		VALUES ($1, 'media_delete', $2, $3::jsonb)`, nullString(moderatorID), ownerID, meta); err != nil {
		return MediaAssetRow{}, fmt.Errorf("store: media delete action log: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return MediaAssetRow{}, fmt.Errorf("store: commit media delete: %w", err)
	}
	return s.GetMediaAsset(ctx, id)
}
