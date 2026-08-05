-- 0004_moderation.sql — moderation foundation for anoon (Phase D).
--
-- Adds the tables the admin panel + companion moderation surface need (see
-- COMPANION-ADMIN-API.md §1/§2/§4): a full ban ledger, an append-only moderator
-- action journal, and a media asset registry (view-once / gallery / escalation).
-- The user-submitted `reports` table already exists (0001_init) and is reused as
-- the write target for POST /reports — it is NOT recreated here.
--
-- It also extends `users` with two columns the moderation/presence features need:
--   * real_gender — the account's real registered gender, distinct from the
--     matcher `gender` (which drives roulette pairing). Admin "Online" listing
--     groups by this. Nullable so existing rows don't break; set at registration.
--   * last_seen   — companion-owned presence heartbeat. Anon topics carry no P
--     bit (see COMPANION-PLAN.md §0), so Tinode {pres} is not a source of truth;
--     companion stamps this on incoming REST/WS activity instead.

-- ---------------------------------------------------------------------------
-- users: moderation/presence extensions.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN real_gender TEXT
    CHECK (real_gender IS NULL OR real_gender IN ('male', 'female', 'other'));
ALTER TABLE users ADD COLUMN last_seen TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- bans: the ban ledger. One row per ban action (a user may accumulate several
-- over their lifetime); at most one should be 'active' at a time (enforced by
-- the store, not a constraint, to keep temporary/permanent history intact).
--   * permanent  — true for indefinite bans (expires_at is then NULL).
--   * expires_at — when a temporary ban lapses; companion flips it 'expired'.
--   * status     — 'active' (in force), 'expired' (temp ban lapsed),
--                  'lifted' (a moderator unbanned early).
-- ---------------------------------------------------------------------------
CREATE TABLE bans (
    id            BIGSERIAL   PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Operator (admin) id as supplied by the admin service; free-form text
    -- because AdminUser lives outside companion (see COMPANION-ADMIN-API.md §7).
    moderator_id  TEXT,
    reason        TEXT,
    permanent     BOOLEAN     NOT NULL DEFAULT false,
    expires_at    TIMESTAMPTZ,
    status        TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'expired', 'lifted')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bans_user_idx   ON bans (user_id);
CREATE INDEX bans_status_idx ON bans (status);

-- ---------------------------------------------------------------------------
-- moderator_actions: append-only audit journal of every moderation act. This is
-- the durable record (the admin UI's own "Журнал" is a session log — see §7).
--   * action_type    — 'ban' | 'unban' | 'mute' | 'unmute' | 'dismiss_report' …
--   * target_report_id — set when the action resolves a specific report.
--   * meta           — arbitrary structured context (expiresAt, role, note …).
-- ---------------------------------------------------------------------------
CREATE TABLE moderator_actions (
    id               BIGSERIAL   PRIMARY KEY,
    moderator_id     TEXT,
    action_type      TEXT        NOT NULL,
    target_user_id   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    target_report_id BIGINT      REFERENCES reports(id) ON DELETE SET NULL,
    meta             JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX moderator_actions_target_user_idx ON moderator_actions (target_user_id);
CREATE INDEX moderator_actions_type_idx        ON moderator_actions (action_type);

-- ---------------------------------------------------------------------------
-- media_assets: registry of media exchanged in chats — powers the admin Files/
-- Gallery sections and view-once (ephemeral) lifecycle (COMPANION-ADMIN-API.md §4).
--   * kind      — 'image' | 'video' | 'audio'.
--   * ephemeral — view-once asset (deleted after first view / TTL).
--   * escalated — retained past its TTL because a report references it
--                 (POST /reports sets this so cleanup won't purge evidence).
-- ---------------------------------------------------------------------------
CREATE TABLE media_assets (
    id          BIGSERIAL   PRIMARY KEY,
    owner_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Tinode topic the asset was posted in (anon or friend chat), if known.
    topic       TEXT,
    kind        TEXT        NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
    url         TEXT        NOT NULL,
    ephemeral   BOOLEAN     NOT NULL DEFAULT false,
    expires_at  TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    escalated   BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX media_assets_owner_idx ON media_assets (owner_id);
CREATE INDEX media_assets_topic_idx ON media_assets (topic);
