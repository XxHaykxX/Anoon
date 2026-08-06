package api

// media.go implements companion's side of the media_assets registry
// (COMPANION-ADMIN-API.md §4): POST /media lets the frontend log a reference
// right after it uploads a file straight to Tinode's own upload handler (the
// bytes never touch companion — see companion/README.md and
// internal/db/migrations/0004_moderation.sql for what's tracked and why), and
// the admin Files/Gallery endpoints below read that registry back. Report
// escalation (marking an asset `escalated` so cleanup can't purge it while a
// report is open) is wired from handleCreateReport in reports.go. This is the
// canonical contract — the settings-invite client builds against it directly
// (kind + ephemeral/ttlSeconds feed #88's view-once flow).
//
// Note on envelopes: §4's example responses use bespoke `files`/`folders` keys,
// but the admin list endpoint below returns the same Refine `{data, total}`
// envelope as every other /admin/* list (see writeList in admin.go) — this
// keeps the wire format consistent across the admin surface rather than
// matching the spec doc literally; there is no built admin-UI consumer yet to
// break.

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"anoon/companion/internal/store"
)

// createMediaRequest is the body of POST /media. url is wherever Tinode's
// upload handler put the file (the frontend gets this back from its own
// upload call); ttlSeconds is only meaningful when ephemeral is true (0/absent
// = no expiry set, e.g. view-once-by-open-not-by-time).
type createMediaRequest struct {
	Topic      string `json:"topic"`
	Kind       string `json:"kind"`
	URL        string `json:"url"`
	Ephemeral  bool   `json:"ephemeral"`
	TTLSeconds int    `json:"ttlSeconds"`
}

// tinodeFileRef is the only URL shape POST /media accepts: the relative ref
// Tinode's own upload handler hands back (`/v0/file/s/<id>` — see
// internal/db/migrations/0007_media_assets.sql and uploadFile in
// frontend/src/lib/tinode.ts). Everything the frontend logs here comes out of
// that call, so any other shape is a URL the caller chose — and this registry
// is what the admin gallery renders, where a moderator would click it.
const tinodeFileRef = "/v0/file/s/"

// maxMediaURL bounds the stored ref. Real refs are ~30 chars; this only stops
// a caller stuffing the column.
const maxMediaURL = 512

// validMediaURL reports whether raw is a file ref this deployment's upload
// handler could have produced: the fixed download prefix followed by exactly
// one path segment. Deliberately strict — a scheme, a host (`//evil/x`), a
// parent traversal, a query or a fragment all mean the URL was built by the
// caller rather than returned by the upload.
func validMediaURL(raw string) bool {
	name, ok := strings.CutPrefix(raw, tinodeFileRef)
	if !ok || name == "" || name == "." || name == ".." || len(raw) > maxMediaURL {
		return false
	}
	for _, r := range name {
		if r <= ' ' || r == 0x7f || strings.ContainsRune(`/\?#`, r) {
			return false
		}
	}
	return true
}

// handleCreateMediaAsset lets an authenticated user log a media reference
// after uploading it. This is a fire-and-forget tracking call from the
// frontend's perspective — it does not gate or move the upload itself.
func (s *Server) handleCreateMediaAsset(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req createMediaRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	url := strings.TrimSpace(req.URL)
	if url == "" {
		writeError(w, http.StatusBadRequest, "invalid_url", "url is required")
		return
	}
	if !validMediaURL(url) {
		writeError(w, http.StatusBadRequest, "invalid_url", "url must be an upload ref of the form "+tinodeFileRef+"...")
		return
	}
	if !store.ValidMediaKind(req.Kind) {
		writeError(w, http.StatusBadRequest, "invalid_kind", "kind must be image|video|audio")
		return
	}
	// A topic is optional (an asset need not belong to a chat), but a supplied
	// one must be a conversation the caller is actually in — otherwise anyone
	// could file media into someone else's chat, and a report on that topic
	// would then escalate it.
	if req.Topic != "" {
		if _, ok := topicMemberFor(r.Context(), s.Store, u, req.Topic); !ok {
			writeError(w, http.StatusForbidden, "not_in_topic", "not a member of that conversation")
			return
		}
	}

	var expiresAt *time.Time
	if req.Ephemeral && req.TTLSeconds > 0 {
		t := time.Now().Add(time.Duration(req.TTLSeconds) * time.Second)
		expiresAt = &t
	}

	row, err := s.Store.CreateMediaAsset(r.Context(), u.ID, req.Topic, req.Kind, url, req.Ephemeral, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not save media reference")
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

// --- topic participation ------------------------------------------------------

// topicMembership is the slice of the store the participation check needs. It
// is an interface so the rule itself is unit-testable without a database.
type topicMembership interface {
	MatchByTopic(ctx context.Context, topic string) (store.Match, error)
	UserByTinodeUID(ctx context.Context, tinodeUID string) (store.User, error)
	AreFriends(ctx context.Context, a, b int64) (bool, error)
}

// topicMember is the caller's place in a conversation: who the other member is,
// and which of the two topic shapes named it.
type topicMember struct {
	PeerID int64 // the other member's companion user id
	P2P    bool  // a Tinode p2p (usrXXX) friend topic, not a roulette grp one
}

// topicMemberFor reports whether u is actually part of the conversation `topic`
// names, and resolves the other member. It is the same membership rule the
// relay path already enforces (relayTopicPeer in callsignal.go), because the
// same two topic shapes reach the endpoints that carry a topic:
//
//   - grpXXX — a roulette pair topic: one name, shared by both members and
//     unique to the pairing. Membership is the roulette_matches row, whatever
//     its status — the anonymous phase, a revealed pair and an ended chat are
//     all conversations the caller was legitimately in.
//   - usrXXX — a Tinode p2p friend topic, named per-user after the OTHER side.
//     Membership is an accepted friendship with the user the topic names (see
//     store.AreFriends, which exists for exactly this question).
//
// ok=false means "the caller is not in that conversation": an unknown topic, a
// match the caller is not part of, a p2p topic naming a stranger or the caller
// themselves.
func topicMemberFor(ctx context.Context, m topicMembership, u store.User, topic string) (topicMember, bool) {
	if strings.HasPrefix(topic, "usr") {
		// tinode_uid is stored WITH the "usr" prefix, so the topic name is the
		// lookup key as-is.
		peer, err := m.UserByTinodeUID(ctx, topic)
		if err != nil || peer.ID == 0 || peer.ID == u.ID {
			return topicMember{}, false
		}
		friends, err := m.AreFriends(ctx, u.ID, peer.ID)
		if err != nil || !friends {
			return topicMember{}, false
		}
		return topicMember{PeerID: peer.ID, P2P: true}, true
	}

	match, err := m.MatchByTopic(ctx, topic)
	if err != nil || !match.Has(u.ID) {
		return topicMember{}, false
	}
	return topicMember{PeerID: match.Peer(u.ID)}, true
}

// --- admin: Files / Gallery (§4) ---------------------------------------------

// handleAdminListMedia serves GET /admin/media?ownerId=&kind=&from=&to=&page=&pageSize=
// (the "all" gallery view is simply ownerId omitted). from/to are RFC3339.
func (s *Server) handleAdminListMedia(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := maxInt(atoiOr(q.Get("page"), 1), 1)
	perPage := atoiOr(q.Get("pageSize"), 25)
	if perPage <= 0 || perPage > 500 {
		perPage = 25
	}

	p := store.MediaListParams{
		Kind:   strings.TrimSpace(q.Get("kind")),
		Offset: (page - 1) * perPage,
		Limit:  perPage,
	}
	if v := strings.TrimSpace(q.Get("ownerId")); v != "" {
		if n, err := strconv.ParseInt(strings.TrimPrefix(v, "#"), 10, 64); err == nil {
			p.OwnerID = n
		}
	}
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			p.From = &t
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			p.To = &t
		}
	}

	rows, total, err := s.Store.ListMediaAssets(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not list media")
		return
	}
	writeList(w, rows, total)
}

// handleAdminMediaFolders serves GET /admin/media/folders: a per-owner rollup
// of non-deleted asset counts, for the admin Files section's folder view.
func (s *Server) handleAdminMediaFolders(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Store.ListMediaFolders(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not list media folders")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"folders": rows})
}

// adminMediaPatch is the PATCH /admin/media/{id} body. deleted=true is
// currently the only supported mutation (soft-delete; see
// store.SoftDeleteMediaAsset — it does not purge the underlying file, only
// marks the reference deleted_at so the admin UI can hide/flag it).
type adminMediaPatch struct {
	Deleted *bool `json:"deleted"`
}

func (s *Server) handleAdminPatchMedia(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", "media id must be numeric")
		return
	}
	var req adminMediaPatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if req.Deleted == nil || !*req.Deleted {
		writeError(w, http.StatusBadRequest, "no_op", `supply {"deleted": true}`)
		return
	}

	row, err := s.Store.SoftDeleteMediaAsset(r.Context(), id, adminID(r.Context()))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not delete media asset")
		return
	}
	writeJSON(w, http.StatusOK, row)
}
