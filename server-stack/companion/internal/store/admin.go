package store

// admin.go holds the read/aggregate queries that back the companion admin API
// (COMPANION-ADMIN-API.md §1/§2): report/user/ban listings with Refine-style
// pagination + equality filters, the overview counters, the online listing, and
// the presence heartbeat. The mutating moderation primitives (ban/unban/mute/
// unmute + their ledger writes) live in moderation.go and are NOT duplicated
// here — the admin handlers call those directly.

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ListParams carries generic pagination/sort/filter options for admin list
// endpoints. Offset/Limit are already resolved from the request; Sort is a
// caller-supplied sort field (whitelisted against real columns inside each
// query — never interpolated raw); Order is "asc"|"desc"; Filters holds the
// f_<field> equality filters, keyed by field name.
type ListParams struct {
	Offset  int
	Limit   int
	Sort    string
	Order   string
	Filters map[string]string
	// IDs restricts the page to an explicit set of row ids — the documented
	// `ids` csv (COMPANION-ADMIN-API.md §1), which is how Refine asks for a
	// getMany. nil means "no restriction"; an EMPTY, NON-NIL slice means the
	// caller did ask for a set and none of it parsed, which must answer with no
	// rows rather than the whole table. Getting that distinction wrong turns a
	// getMany of one deleted row into a dump of everything.
	IDs []int64
}

// idClause renders "col IN ($n, $n+1, ...)" for an explicit id set, numbering
// the placeholders after the argsSoFar the caller has already bound. Every id
// travels as a parameter — the only thing interpolated is the column name,
// which is a literal at every call site. Returns "" when ids is nil (no
// restriction) and the constant-false predicate when the set is empty (see
// ListParams.IDs).
func idClause(col string, ids []int64, argsSoFar int) (string, []any) {
	if ids == nil {
		return "", nil
	}
	if len(ids) == 0 {
		return "false", nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for n, id := range ids {
		placeholders[n] = "$" + strconv.Itoa(argsSoFar+1+n)
		args[n] = id
	}
	return col + " IN (" + strings.Join(placeholders, ", ") + ")", args
}

// PadHashID renders a numeric #ID as a zero-padded public id WITHOUT the leading
// '#', e.g. 3 -> "00003" (the `publicId`/`targetPublicId` shape the admin UI wants).
func PadHashID(n int64) string { return fmt.Sprintf("%05d", n) }

// orderClause builds a safe "ORDER BY col dir" from a whitelist. sort is looked
// up in allowed (field -> column); an unknown field falls back to def. Only the
// hard-coded column strings and ASC/DESC ever reach SQL, so this is injection-safe.
func orderClause(sort, order string, allowed map[string]string, def string) string {
	col, ok := allowed[sort]
	if !ok {
		col = def
	}
	dir := "DESC"
	if strings.EqualFold(order, "asc") {
		dir = "ASC"
	}
	return "ORDER BY " + col + " " + dir
}

// --- reports ----------------------------------------------------------------

// ReportRow is one admin "Жалобы" row (COMPANION-ADMIN-API.md §1). reason maps
// to the DB `category`, note to `details`. Public ids are denormalized from the
// joined users so the UI needs no extra lookups.
type ReportRow struct {
	ID               int64      `json:"id"`
	ReporterID       int64      `json:"reporterId"`
	ReporterPublicID string     `json:"reporterPublicId"`
	TargetProfileID  int64      `json:"targetProfileId"`
	TargetNickname   string     `json:"targetNickname"`
	TargetPublicID   string     `json:"targetPublicId"`
	Reason           string     `json:"reason"`
	Topic            string     `json:"topic"`
	Note             string     `json:"note"`
	Status           string     `json:"status"`
	CreatedAt        time.Time  `json:"createdAt"`
	ResolvedAt       *time.Time `json:"resolvedAt"`
}

const reportSelect = `
	SELECT r.id, r.reporter_id, rep.hash_id, r.reported_id, tgt.hash_id,
	       r.category, COALESCE(r.topic, ''), COALESCE(r.details, ''),
	       r.status, r.created_at, r.resolved_at
	FROM reports r
	JOIN users rep ON rep.id = r.reporter_id
	JOIN users tgt ON tgt.id = r.reported_id`

func scanReport(sc interface{ Scan(...any) error }) (ReportRow, error) {
	var row ReportRow
	var reporterHash, targetHash int64
	var resolved sql.NullTime
	if err := sc.Scan(&row.ID, &row.ReporterID, &reporterHash, &row.TargetProfileID,
		&targetHash, &row.Reason, &row.Topic, &row.Note, &row.Status,
		&row.CreatedAt, &resolved); err != nil {
		return ReportRow{}, err
	}
	row.ReporterPublicID = PadHashID(reporterHash)
	row.TargetPublicID = PadHashID(targetHash)
	row.TargetNickname = FormatHashID(targetHash)
	if resolved.Valid {
		t := resolved.Time
		row.ResolvedAt = &t
	}
	return row, nil
}

// ListReports returns a page of reports plus the total (pre-pagination) count.
// Honors the f_status equality filter and the `ids` set.
func (s *Store) ListReports(ctx context.Context, p ListParams) ([]ReportRow, int, error) {
	args := []any{p.Filters["status"]}
	where := "WHERE ($1 = '' OR r.status = $1)"
	if clause, idArgs := idClause("r.id", p.IDs, len(args)); clause != "" {
		where += " AND " + clause
		args = append(args, idArgs...)
	}

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM reports r `+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("store: count reports: %w", err)
	}

	order := orderClause(p.Sort, p.Order,
		map[string]string{"createdAt": "r.created_at", "status": "r.status", "id": "r.id"}, "r.created_at")
	q := reportSelect + " " + where + " " + order +
		fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	rows, err := s.db.QueryContext(ctx, q, append(append([]any{}, args...), p.Limit, p.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("store: list reports: %w", err)
	}
	defer rows.Close()

	out := make([]ReportRow, 0, p.Limit)
	for rows.Next() {
		row, err := scanReport(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("store: scan report: %w", err)
		}
		out = append(out, row)
	}
	return out, total, rows.Err()
}

// GetReport loads a single report row (used to echo the updated resource back).
func (s *Store) GetReport(ctx context.Context, id int64) (ReportRow, error) {
	row, err := scanReport(s.db.QueryRowContext(ctx, reportSelect+" WHERE r.id = $1", id))
	if err != nil {
		return ReportRow{}, fmt.Errorf("store: get report %d: %w", id, err)
	}
	return row, nil
}

// UpdateReportStatus moves a report through its lifecycle
// (open -> reviewing -> resolved | dismissed), stamps resolved_at on a terminal
// status, and appends a moderator_actions journal entry linked to the report.
// It does NOT itself ban anyone — the ban side effect is applied by the handler
// (which also enforces the super_admin role gate). Returns the updated row.
func (s *Store) UpdateReportStatus(ctx context.Context, reportID int64, status, moderatorID string) (ReportRow, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ReportRow{}, fmt.Errorf("store: begin report tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	resolvedSet := ""
	if status == "resolved" || status == "dismissed" {
		resolvedSet = ", resolved_at = now()"
	} else {
		resolvedSet = ", resolved_at = NULL"
	}
	res, err := tx.ExecContext(ctx,
		`UPDATE reports SET status = $1`+resolvedSet+` WHERE id = $2`, status, reportID)
	if err != nil {
		return ReportRow{}, fmt.Errorf("store: update report: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ReportRow{}, sql.ErrNoRows
	}

	action := "review_report"
	switch status {
	case "resolved":
		action = "resolve_report"
	case "dismissed":
		action = "dismiss_report"
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO moderator_actions (moderator_id, action_type, target_report_id)
		 VALUES ($1, $2, $3)`, nullString(moderatorID), action, reportID); err != nil {
		return ReportRow{}, fmt.Errorf("store: report action log: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ReportRow{}, fmt.Errorf("store: commit report: %w", err)
	}
	return s.GetReport(ctx, reportID)
}

// ReportedUserID returns the companion user id the report targets (the account
// to ban when a report resolves with an action).
func (s *Store) ReportedUserID(ctx context.Context, reportID int64) (int64, error) {
	var uid int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT reported_id FROM reports WHERE id = $1`, reportID).Scan(&uid); err != nil {
		return 0, fmt.Errorf("store: reported user for report %d: %w", reportID, err)
	}
	return uid, nil
}

// --- users / profiles -------------------------------------------------------

// ProfileRow is one admin "Пользователи"/"Онлайн" row (§1/§2). online is filled
// by the handler from the in-memory WS hub (not derivable in SQL); banned/muted/
// reportCount are computed here. realGender/lastSeen may be null on old rows.
// DeletedAt is set once the account has gone through self-service deletion
// (DELETE /me -> Store.DeleteUser) — the row itself is kept (hash_id/#ID is
// never reused) so this is the only signal that it's gone.
type ProfileRow struct {
	ID          int64      `json:"id"`
	PublicID    string     `json:"publicId"`
	HashID      int64      `json:"hashId"`
	Nickname    string     `json:"nickname"`
	Gender      string     `json:"gender"`
	RealGender  *string    `json:"realGender"`
	State       string     `json:"state"`
	Banned      bool       `json:"banned"`
	Muted       bool       `json:"muted"`
	ReportCount int        `json:"reportCount"`
	Online      bool       `json:"online"`
	Age         *int       `json:"age"`
	LastSeen    *time.Time `json:"lastSeen"`
	DeletedAt   *time.Time `json:"deletedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// profileCols is the shared SELECT list for profile rows. It embeds a report
// count subquery and computes banned/muted from the moderation columns.
const profileCols = `u.id, u.hash_id, u.gender, u.real_gender, u.state, u.age, u.last_seen, u.deleted_at, u.created_at,
	(SELECT count(*) FROM reports rr WHERE rr.reported_id = u.id),
	(u.state = 'susp' AND (u.ban_until IS NULL OR u.ban_until > now())),
	(u.mute_until IS NOT NULL AND u.mute_until > now())`

func scanProfile(sc interface{ Scan(...any) error }) (ProfileRow, error) {
	var p ProfileRow
	var realGender sql.NullString
	var age sql.NullInt64
	var lastSeen, deletedAt sql.NullTime
	if err := sc.Scan(&p.ID, &p.HashID, &p.Gender, &realGender, &p.State, &age, &lastSeen, &deletedAt,
		&p.CreatedAt, &p.ReportCount, &p.Banned, &p.Muted); err != nil {
		return ProfileRow{}, err
	}
	p.PublicID = PadHashID(p.HashID)
	p.Nickname = FormatHashID(p.HashID)
	if realGender.Valid {
		p.RealGender = &realGender.String
	}
	if age.Valid {
		a := int(age.Int64)
		p.Age = &a
	}
	if lastSeen.Valid {
		t := lastSeen.Time
		p.LastSeen = &t
	}
	if deletedAt.Valid {
		t := deletedAt.Time
		p.DeletedAt = &t
	}
	return p, nil
}

// ListUsers returns a page of profiles + total count. Filters: f_hashId (exact
// #ID), f_state ('ok'|'susp'), f_banned ('true' = currently-active ban). online
// is NOT set here (the handler overlays it from the hub).
func (s *Store) ListUsers(ctx context.Context, p ListParams) ([]ProfileRow, int, error) {
	var where []string
	var args []any
	i := 1

	if v := strings.TrimSpace(p.Filters["hashId"]); v != "" {
		if n, err := strconv.ParseInt(strings.TrimPrefix(v, "#"), 10, 64); err == nil {
			where = append(where, fmt.Sprintf("u.hash_id = $%d", i))
			args = append(args, n)
			i++
		} else {
			where = append(where, "false") // unparseable #ID -> no matches
		}
	}
	if v := strings.TrimSpace(p.Filters["state"]); v != "" {
		where = append(where, fmt.Sprintf("u.state = $%d", i))
		args = append(args, v)
		i++
	}
	if v := strings.TrimSpace(p.Filters["banned"]); v == "true" {
		where = append(where, "(u.state = 'susp' AND (u.ban_until IS NULL OR u.ban_until > now()))")
	}
	if clause, idArgs := idClause("u.id", p.IDs, len(args)); clause != "" {
		where = append(where, clause)
		args = append(args, idArgs...)
		i = len(args) + 1
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := s.db.QueryRowContext(ctx,
		"SELECT count(*) FROM users u "+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("store: count users: %w", err)
	}

	order := orderClause(p.Sort, p.Order, map[string]string{
		"createdAt": "u.created_at", "hashId": "u.hash_id", "id": "u.id", "lastSeen": "u.last_seen",
	}, "u.created_at")
	q := "SELECT " + profileCols + " FROM users u " + whereSQL + " " + order +
		fmt.Sprintf(" LIMIT $%d OFFSET $%d", i, i+1)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("store: list users: %w", err)
	}
	defer rows.Close()

	out := make([]ProfileRow, 0, p.Limit)
	for rows.Next() {
		row, err := scanProfile(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("store: scan profile: %w", err)
		}
		out = append(out, row)
	}
	return out, total, rows.Err()
}

// ProfileByID loads a single profile row (used to echo an updated user back).
func (s *Store) ProfileByID(ctx context.Context, id int64) (ProfileRow, error) {
	row, err := scanProfile(s.db.QueryRowContext(ctx,
		"SELECT "+profileCols+" FROM users u WHERE u.id = $1", id))
	if err != nil {
		return ProfileRow{}, fmt.Errorf("store: profile %d: %w", id, err)
	}
	return row, nil
}

// --- bans -------------------------------------------------------------------

// BanRow is one admin "Баны" row (§1). state mirrors the DB `status`
// (active|expired|lifted); both fields are emitted so either key works.
type BanRow struct {
	ID        int64      `json:"id"`
	UserID    int64      `json:"userId"`
	ProfileID int64      `json:"profileId"`
	PublicID  string     `json:"publicId"`
	Nickname  string     `json:"nickname"`
	Reason    string     `json:"reason"`
	Permanent bool       `json:"permanent"`
	ExpiresAt *time.Time `json:"expiresAt"`
	Status    string     `json:"status"`
	State     string     `json:"state"`
	CreatedAt time.Time  `json:"createdAt"`
}

const banSelect = `
	SELECT b.id, b.user_id, u.hash_id, COALESCE(b.reason, ''), b.permanent,
	       b.expires_at, b.status, b.created_at
	FROM bans b
	JOIN users u ON u.id = b.user_id`

func scanBan(sc interface{ Scan(...any) error }) (BanRow, error) {
	var b BanRow
	var hash int64
	var expires sql.NullTime
	if err := sc.Scan(&b.ID, &b.UserID, &hash, &b.Reason, &b.Permanent,
		&expires, &b.Status, &b.CreatedAt); err != nil {
		return BanRow{}, err
	}
	b.ProfileID = b.UserID
	b.PublicID = PadHashID(hash)
	b.Nickname = FormatHashID(hash)
	b.State = b.Status
	if expires.Valid {
		t := expires.Time
		b.ExpiresAt = &t
	}
	return b, nil
}

// ListBans returns a page of bans + total count. Honors f_status and the `ids`
// set.
func (s *Store) ListBans(ctx context.Context, p ListParams) ([]BanRow, int, error) {
	args := []any{p.Filters["status"]}
	where := "WHERE ($1 = '' OR b.status = $1)"
	if clause, idArgs := idClause("b.id", p.IDs, len(args)); clause != "" {
		where += " AND " + clause
		args = append(args, idArgs...)
	}

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM bans b `+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("store: count bans: %w", err)
	}

	order := orderClause(p.Sort, p.Order,
		map[string]string{"createdAt": "b.created_at", "status": "b.status", "id": "b.id"}, "b.created_at")
	q := banSelect + " " + where + " " + order +
		fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
	rows, err := s.db.QueryContext(ctx, q, append(append([]any{}, args...), p.Limit, p.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("store: list bans: %w", err)
	}
	defer rows.Close()

	out := make([]BanRow, 0, p.Limit)
	for rows.Next() {
		b, err := scanBan(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("store: scan ban: %w", err)
		}
		out = append(out, b)
	}
	return out, total, rows.Err()
}

// GetBan loads a single ban row (echoed back after a lift).
func (s *Store) GetBan(ctx context.Context, id int64) (BanRow, error) {
	b, err := scanBan(s.db.QueryRowContext(ctx, banSelect+" WHERE b.id = $1", id))
	if err != nil {
		return BanRow{}, fmt.Errorf("store: get ban %d: %w", id, err)
	}
	return b, nil
}

// --- overview / online / presence ------------------------------------------

// Overview is the admin dashboard summary (§2). online* count users whose
// last_seen falls inside the presence window, split by real_gender.
type Overview struct {
	Total        int `json:"total"`
	Online       int `json:"online"`
	OnlineMale   int `json:"onlineMale"`
	OnlineFemale int `json:"onlineFemale"`
	OnlineOther  int `json:"onlineOther"`
	MatchesToday int `json:"matchesToday"`
	ReportsOpen  int `json:"reportsOpen"`
	BansActive   int `json:"bansActive"`
}

// Overview computes the dashboard counters in one round of small aggregates.
// `since` is the presence cutoff (now - window) for the online counts.
func (s *Store) Overview(ctx context.Context, since time.Time) (Overview, error) {
	var o Overview
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&o.Total); err != nil {
		return o, fmt.Errorf("store: overview total: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT COALESCE(real_gender, 'other'), count(*)
		FROM users
		WHERE last_seen IS NOT NULL AND last_seen >= $1
		GROUP BY COALESCE(real_gender, 'other')`, since)
	if err != nil {
		return o, fmt.Errorf("store: overview online: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var g string
		var n int
		if err := rows.Scan(&g, &n); err != nil {
			return o, fmt.Errorf("store: scan online: %w", err)
		}
		o.Online += n
		switch g {
		case "male":
			o.OnlineMale = n
		case "female":
			o.OnlineFemale = n
		default:
			o.OnlineOther += n
		}
	}
	if err := rows.Err(); err != nil {
		return o, err
	}

	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM roulette_matches WHERE created_at >= date_trunc('day', now())`).
		Scan(&o.MatchesToday); err != nil {
		return o, fmt.Errorf("store: overview matches: %w", err)
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM reports WHERE status IN ('open', 'reviewing')`).
		Scan(&o.ReportsOpen); err != nil {
		return o, fmt.Errorf("store: overview reports: %w", err)
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM bans WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())`).
		Scan(&o.BansActive); err != nil {
		return o, fmt.Errorf("store: overview bans: %w", err)
	}
	return o, nil
}

// OnlineUsers lists users seen since `since`, most-recent first, optionally
// filtered to a single real_gender ('male'|'female'|'other'; "" = any). Rows are
// ProfileRows (online overlaid true by the handler for anyone with a live socket).
func (s *Store) OnlineUsers(ctx context.Context, since time.Time, gender string, limit int) ([]ProfileRow, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	args := []any{since}
	genderSQL := ""
	if gender == "male" || gender == "female" || gender == "other" {
		genderSQL = " AND u.real_gender = $2"
		args = append(args, gender)
	}
	q := "SELECT " + profileCols + " FROM users u WHERE u.last_seen IS NOT NULL AND u.last_seen >= $1" +
		genderSQL + " ORDER BY u.last_seen DESC LIMIT " + strconv.Itoa(limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("store: online users: %w", err)
	}
	defer rows.Close()

	out := make([]ProfileRow, 0, limit)
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, fmt.Errorf("store: scan online user: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// TouchPresence stamps users.last_seen = now() for the given user. It is the
// companion-owned presence heartbeat (anon topics carry no Tinode P bit, so
// {pres} is not a source of truth — see COMPANION-PLAN.md §0). Called on
// authenticated REST calls, on WS connect, and on each WS keepalive pong.
func (s *Store) TouchPresence(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE users SET last_seen = now() WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("store: touch presence %d: %w", userID, err)
	}
	return nil
}
