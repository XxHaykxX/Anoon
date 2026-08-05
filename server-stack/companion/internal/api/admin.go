package api

// admin.go implements the companion admin HTTP API (COMPANION-ADMIN-API.md
// §1/§2): the shared-secret middleware, Refine-style list envelope + pagination
// + f_<field> filters, and the reports/users/bans/overview/online handlers.
//
// Trust model (see spec §0): these routes are called server-to-server by the
// admin service, gated by the X-Companion-Admin-Secret shared secret. The admin
// service has already enforced operator auth; it forwards the acting operator as
// X-Admin-Id (attribution, written to moderator_actions) and X-Admin-Role
// (super_admin|moderator). Companion additionally hard-gates the destructive
// actions — permanent ban and any unban/lift require super_admin.

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"anoon/companion/internal/push"
	"anoon/companion/internal/store"
)

// onlineWindow is how recently a user must have been seen (last_seen) to count
// as "online" for the overview counters and the online listing.
const onlineWindow = 90 * time.Second

// roleSuperAdmin is the operator role permitted to run destructive moderation
// (permanent ban, unban, lift). roleModerator may do everything else.
const roleSuperAdmin = "super_admin"

// adminCtxKey namespaces the values the middleware stashes in the request context.
type adminCtxKey int

const (
	adminIDKey adminCtxKey = iota
	adminRoleKey
)

// adminOnly wraps an admin handler with the shared-secret gate. When no secret
// is configured the whole admin surface is disabled (503). A wrong/absent secret
// is 401. On success the acting operator id/role are placed in the context for
// attribution + role gating.
func (s *Server) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.AdminSecret == "" {
			writeError(w, http.StatusServiceUnavailable, "admin_disabled", "admin API is disabled")
			return
		}
		got := r.Header.Get("X-Companion-Admin-Secret")
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.AdminSecret)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "invalid admin secret")
			return
		}
		ctx := context.WithValue(r.Context(), adminIDKey, r.Header.Get("X-Admin-Id"))
		ctx = context.WithValue(ctx, adminRoleKey, r.Header.Get("X-Admin-Role"))
		next(w, r.WithContext(ctx))
	}
}

// adminID / adminRole read the operator attribution the middleware stored.
func adminID(ctx context.Context) string {
	v, _ := ctx.Value(adminIDKey).(string)
	return v
}

func adminRole(ctx context.Context) string {
	v, _ := ctx.Value(adminRoleKey).(string)
	return v
}

// requireSuperAdmin writes a 403 and returns false unless the operator is a
// super_admin. Used to gate permanent ban / unban / lift.
func requireSuperAdmin(w http.ResponseWriter, ctx context.Context) bool {
	if adminRole(ctx) != roleSuperAdmin {
		writeError(w, http.StatusForbidden, "forbidden", "action requires super_admin role")
		return false
	}
	return true
}

// writeList emits the Refine list envelope { "data": [...], "total": N }.
func writeList(w http.ResponseWriter, data any, total int) {
	writeJSON(w, http.StatusOK, map[string]any{"data": data, "total": total})
}

// parseListParams resolves pagination/sort/filters from the query. It accepts
// Refine's _start/_end and _page/_perPage as well as the plain page/pageSize
// documented in the spec; f_<field> query keys become equality filters.
func parseListParams(r *http.Request) store.ListParams {
	q := r.URL.Query()
	offset, limit := 0, 25

	if s := q.Get("_start"); s != "" {
		start := atoiOr(s, 0)
		end := atoiOr(q.Get("_end"), start+limit)
		offset = start
		if end > start {
			limit = end - start
		}
	} else if p := q.Get("_page"); p != "" {
		page := maxInt(atoiOr(p, 1), 1)
		per := atoiOr(firstNonEmpty(q.Get("_perPage"), q.Get("pageSize")), 25)
		offset, limit = (page-1)*per, per
	} else if p := q.Get("page"); p != "" {
		page := maxInt(atoiOr(p, 1), 1)
		per := atoiOr(q.Get("pageSize"), 25)
		offset, limit = (page-1)*per, per
	}
	if limit <= 0 || limit > 500 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}

	filters := make(map[string]string)
	for k, vs := range q {
		if strings.HasPrefix(k, "f_") && len(vs) > 0 {
			filters[strings.TrimPrefix(k, "f_")] = vs[0]
		}
	}

	return store.ListParams{
		Offset:  offset,
		Limit:   limit,
		Sort:    firstNonEmpty(q.Get("_sort"), q.Get("sort")),
		Order:   firstNonEmpty(q.Get("_order"), q.Get("order")),
		Filters: filters,
	}
}

func atoiOr(s string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
		return n
	}
	return def
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// pathID parses the {id} path segment as an int64.
func pathID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

// touchPresence stamps the user's last_seen asynchronously (best-effort; never
// blocks the request or fails it). This is the companion presence heartbeat —
// see store.TouchPresence.
//
// Writes are throttled per user to presenceThrottle: the first call in a window
// records the timestamp and issues the UPDATE; subsequent calls (further REST
// hits, WS pongs) inside the window return immediately without touching the DB,
// which removes the last_seen write amplification.
func (s *Server) touchPresence(userID int64) {
	now := time.Now()
	s.presenceMu.Lock()
	if last, ok := s.presenceLast[userID]; ok && now.Sub(last) < presenceThrottle {
		s.presenceMu.Unlock()
		return
	}
	s.presenceLast[userID] = now
	s.presenceMu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.Store.TouchPresence(ctx, userID); err != nil {
			log.Printf("presence: touch user %d: %v", userID, err)
		}
	}()
}

// --- reports ----------------------------------------------------------------

func (s *Server) handleAdminListReports(w http.ResponseWriter, r *http.Request) {
	rows, total, err := s.Store.ListReports(r.Context(), parseListParams(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not list reports")
		return
	}
	writeList(w, rows, total)
}

// adminReportPatch is the PATCH /admin/reports/{id} body. status moves the
// report through its lifecycle; action "ban" additionally bans the reported user
// (permanent -> super_admin only).
type adminReportPatch struct {
	Status string `json:"status"`
	Action string `json:"action"` // optional: "ban"
	Reason string `json:"reason"`
}

var validReportStatus = map[string]bool{
	"open": true, "reviewing": true, "resolved": true, "dismissed": true,
}

func (s *Server) handleAdminPatchReport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", "report id must be numeric")
		return
	}
	var req adminReportPatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if !validReportStatus[req.Status] {
		writeError(w, http.StatusBadRequest, "invalid_status", "status must be open|reviewing|resolved|dismissed")
		return
	}
	ctx := r.Context()

	// Optional ban action. Banning via a report is a permanent ban, so it is
	// gated to super_admin.
	if req.Action == "ban" {
		if !requireSuperAdmin(w, ctx) {
			return
		}
		targetID, err := s.Store.ReportedUserID(ctx, id)
		if err != nil {
			writeError(w, http.StatusNotFound, "no_such_report", "report not found")
			return
		}
		reason := req.Reason
		if reason == "" {
			reason = "resolved via report"
		}
		if _, err := s.Store.BanUser(ctx, targetID, adminID(ctx), reason, true, nil); err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "could not ban reported user")
			return
		}
		s.tinodeBan(ctx, targetID)
	}

	row, err := s.Store.UpdateReportStatus(ctx, id, req.Status, adminID(ctx))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "no_such_report", "report not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not update report")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// --- users ------------------------------------------------------------------

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	rows, total, err := s.Store.ListUsers(r.Context(), parseListParams(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not list users")
		return
	}
	// Overlay live-socket presence onto each row.
	for i := range rows {
		rows[i].Online = s.Hub.Online(rows[i].ID)
	}
	writeList(w, rows, total)
}

// adminUserPatch is the PATCH /admin/users/{id} body. It supports ban/unban and
// mute/unmute; the pointer fields distinguish "not supplied" from false.
type adminUserPatch struct {
	Banned     *bool   `json:"banned"`
	ExpiresAt  *string `json:"expiresAt"` // RFC3339; null/absent => permanent ban
	Reason     string  `json:"reason"`
	Muted      *bool   `json:"muted"`
	MutedUntil *string `json:"mutedUntil"` // RFC3339; absent => default 24h
}

func (s *Server) handleAdminPatchUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", "user id must be numeric")
		return
	}
	var req adminUserPatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	ctx := r.Context()

	// Confirm the user exists (and grab the uid for the Tinode side effects).
	target, err := s.Store.UserByID(ctx, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "no_such_user", "user not found")
		return
	}

	switch {
	case req.Banned != nil && *req.Banned:
		permanent := req.ExpiresAt == nil || strings.TrimSpace(*req.ExpiresAt) == ""
		var expiresAt *time.Time
		if !permanent {
			t, perr := time.Parse(time.RFC3339, *req.ExpiresAt)
			if perr != nil {
				writeError(w, http.StatusBadRequest, "invalid_expires_at", "expiresAt must be RFC3339")
				return
			}
			expiresAt = &t
		}
		// Permanent bans are super_admin-only (temporary bans any moderator).
		if permanent && !requireSuperAdmin(w, ctx) {
			return
		}
		if _, err := s.Store.BanUser(ctx, id, adminID(ctx), req.Reason, permanent, expiresAt); err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "could not ban user")
			return
		}
		s.tinodeBanUID(ctx, target.TinodeUID)

	case req.Banned != nil && !*req.Banned:
		// Unban is super_admin-only.
		if !requireSuperAdmin(w, ctx) {
			return
		}
		if err := s.Store.UnbanUser(ctx, id, adminID(ctx)); err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "could not unban user")
			return
		}
		s.tinodeUnbanUID(ctx, target.TinodeUID)

	case req.Muted != nil && *req.Muted:
		until := time.Now().Add(24 * time.Hour)
		if req.MutedUntil != nil && strings.TrimSpace(*req.MutedUntil) != "" {
			t, perr := time.Parse(time.RFC3339, *req.MutedUntil)
			if perr != nil {
				writeError(w, http.StatusBadRequest, "invalid_muted_until", "mutedUntil must be RFC3339")
				return
			}
			until = t
		}
		// Account-wide mute is companion-enforced (users.mute_until); there is no
		// single topic to drop W on from the admin surface.
		if err := s.Store.MuteUser(ctx, id, adminID(ctx), until); err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "could not mute user")
			return
		}

	case req.Muted != nil && !*req.Muted:
		if err := s.Store.UnmuteUser(ctx, id, adminID(ctx)); err != nil {
			writeError(w, http.StatusInternalServerError, "store_failed", "could not unmute user")
			return
		}

	default:
		writeError(w, http.StatusBadRequest, "no_op", "supply one of banned|muted")
		return
	}

	row, err := s.Store.ProfileByID(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not load user")
		return
	}
	row.Online = s.Hub.Online(row.ID)
	writeJSON(w, http.StatusOK, row)
}

// --- bans -------------------------------------------------------------------

func (s *Server) handleAdminListBans(w http.ResponseWriter, r *http.Request) {
	rows, total, err := s.Store.ListBans(r.Context(), parseListParams(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not list bans")
		return
	}
	writeList(w, rows, total)
}

// adminBanPatch is the PATCH /admin/bans/{id} body: the only allowed mutation is
// lifting the ban (state/status = "lifted").
type adminBanPatch struct {
	State  string `json:"state"`
	Status string `json:"status"`
}

func (s *Server) handleAdminPatchBan(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", "ban id must be numeric")
		return
	}
	var req adminBanPatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	want := firstNonEmpty(req.State, req.Status)
	if want != "lifted" {
		writeError(w, http.StatusBadRequest, "invalid_state", "only state=lifted is supported")
		return
	}
	ctx := r.Context()
	// Lifting a ban is super_admin-only (same gate as unban).
	if !requireSuperAdmin(w, ctx) {
		return
	}

	ban, err := s.Store.GetBan(ctx, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "no_such_ban", "ban not found")
		return
	}
	if err := s.Store.UnbanUser(ctx, ban.UserID, adminID(ctx)); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not lift ban")
		return
	}
	s.tinodeUnbanUID(ctx, s.uidFor(ctx, ban.UserID))

	row, err := s.Store.GetBan(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not load ban")
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// --- overview / online ------------------------------------------------------

func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	o, err := s.Store.Overview(r.Context(), time.Now().Add(-onlineWindow))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not build overview")
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (s *Server) handleAdminOnline(w http.ResponseWriter, r *http.Request) {
	gender := r.URL.Query().Get("gender")
	if gender == "any" {
		gender = ""
	}
	rows, err := s.Store.OnlineUsers(r.Context(), time.Now().Add(-onlineWindow), gender, 0)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", "could not list online users")
		return
	}
	for i := range rows {
		rows[i].Online = s.Hub.Online(rows[i].ID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"profiles": rows})
}

// --- broadcast (#117) -------------------------------------------------------

// adminBroadcastRequest is the POST /admin/broadcast body: a push announcement
// fanned out to registered subscriptions. url is optional (deep-link the
// notification opens); title/body are required. gender is optional — "male" or
// "female" targets that audience only; absent/empty broadcasts to everyone.
type adminBroadcastRequest struct {
	Title  string `json:"title"`
	Body   string `json:"body"`
	URL    string `json:"url"`
	Gender string `json:"gender"`
}

// handleAdminBroadcast sends a webpush to the targeted push_subscriptions and
// reports how many deliveries succeeded vs failed. Gated by the same admin
// secret as every other /admin/* route.
func (s *Server) handleAdminBroadcast(w http.ResponseWriter, r *http.Request) {
	var req adminBroadcastRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "malformed request body")
		return
	}
	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Body) == "" {
		writeError(w, http.StatusBadRequest, "invalid_broadcast", "title and body are required")
		return
	}
	gender := strings.TrimSpace(req.Gender)
	if gender != "" && gender != "male" && gender != "female" {
		writeError(w, http.StatusBadRequest, "invalid_gender", "gender, when present, must be 'male' or 'female'")
		return
	}
	sent, failed := s.Push.Broadcast(r.Context(), push.PushPayload{
		Title: req.Title,
		Body:  req.Body,
		Url:   req.URL,
		Tag:   "broadcast",
	}, gender)
	log.Printf("admin: broadcast by %q (gender=%q) — sent %d, failed %d", adminID(r.Context()), gender, sent, failed)
	writeJSON(w, http.StatusOK, map[string]any{"sent": sent, "failed": failed})
}

// --- Tinode side effects (best-effort) --------------------------------------
// The companion DB is the source of truth for moderation state (state='susp'
// blocks the roulette queue; the Tinode account state blocks login). The Tinode
// calls below hard-enforce it (drop live sessions), but a transient ROOT-stream
// outage must not fail an admin action — we log and let reconciliation re-apply.

func (s *Server) tinodeBan(ctx context.Context, userID int64) {
	s.tinodeBanUID(ctx, s.uidFor(ctx, userID))
}

func (s *Server) tinodeBanUID(ctx context.Context, uid string) {
	if uid == "" {
		return
	}
	if err := s.Tinode.Ban(ctx, uid); err != nil {
		log.Printf("admin: tinode ban uid=%s failed (state recorded, needs reconcile): %v", uid, err)
	}
}

func (s *Server) tinodeUnbanUID(ctx context.Context, uid string) {
	if uid == "" {
		return
	}
	if err := s.Tinode.Unban(ctx, uid); err != nil {
		log.Printf("admin: tinode unban uid=%s failed (state recorded, needs reconcile): %v", uid, err)
	}
}

// uidFor resolves a companion user id to its Tinode uid, returning "" (and
// logging) on lookup failure so callers can no-op the Tinode side effect.
func (s *Server) uidFor(ctx context.Context, userID int64) string {
	u, err := s.Store.UserByID(ctx, userID)
	if err != nil {
		log.Printf("admin: uid lookup for user %d failed: %v", userID, err)
		return ""
	}
	return u.TinodeUID
}
