-- 0001_init.sql — initial schema for the anoon companion database.
--
-- Decisions this reflects (see COMPANION-PLAN.md):
--   * #ID: companion owns a 5-digit counter, mapped 1:1 to a Tinode UID.
--     Stored here as hash_id (BIGINT) so we can widen past 99999 without a
--     format migration. No nickname — search is by #ID only.
--   * gender is chosen once at registration and is irreversible.
--   * age is stored as a range bound (age_min/age_max) for matching filters.
--   * Friendship graph source of truth is Tinode p2p subscriptions; this table
--     is only an index for requests/search.
--   * Bans/mutes/reports and the roulette queue live entirely in companion.

-- ---------------------------------------------------------------------------
-- users: one row per anoon account, keyed to a Tinode UID.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id          BIGSERIAL   PRIMARY KEY,
    -- Tinode user id, e.g. "usr2il9suNCR_o". Set once the Tinode account exists.
    tinode_uid  TEXT        UNIQUE,
    -- Public #ID counter value (the "#00001" number). Unique, permanent.
    hash_id     BIGINT      UNIQUE NOT NULL,
    -- 'male' | 'female' — irreversible after registration.
    gender      TEXT        NOT NULL CHECK (gender IN ('male', 'female')),
    -- Self-reported age; range used by the matcher.
    age         INT         CHECK (age IS NULL OR (age BETWEEN 13 AND 120)),
    -- Moderation state mirrored from Tinode account state for quick lookups.
    -- 'ok' | 'susp' (banned). Ban expiry (temporary bans) tracked here.
    state       TEXT        NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'susp')),
    ban_until   TIMESTAMPTZ,
    -- Mute (loss of W right) expiry; NULL when not muted.
    mute_until  TIMESTAMPTZ,
    -- Aggregate rating from the post-chat rating screen (running average).
    rating_sum   BIGINT     NOT NULL DEFAULT 0,
    rating_count BIGINT     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_state_idx ON users (state);

-- Sequence that backs the human-facing #ID. Starts at 1; formatted 5-wide in
-- the app layer (#00001). Reserved/"pretty" ranges can be handled by bumping
-- the sequence before public launch.
CREATE SEQUENCE hash_id_seq START WITH 1 INCREMENT BY 1 OWNED BY users.hash_id;

-- ---------------------------------------------------------------------------
-- friendships: index of friend links + pending friend requests.
-- Tinode p2p subscription is the source of truth; this speeds up requests/UI.
-- ---------------------------------------------------------------------------
CREATE TABLE friendships (
    id          BIGSERIAL   PRIMARY KEY,
    -- Requester and target (companion user ids).
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'pending' (request sent) | 'accepted' | 'blocked'.
    status      TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'blocked')),
    -- How the link originated: 'reveal' (after anon chat), 'search', 'invite'.
    source      TEXT        NOT NULL DEFAULT 'search',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, friend_id)
);

CREATE INDEX friendships_friend_idx ON friendships (friend_id, status);

-- ---------------------------------------------------------------------------
-- reports: user-submitted complaints (Tinode has no notion of these).
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
    id            BIGSERIAL   PRIMARY KEY,
    reporter_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'spam' | 'abuse' | 'sexual' | 'illegal' | 'other'.
    category      TEXT        NOT NULL
                              CHECK (category IN ('spam','abuse','sexual','illegal','other')),
    -- Topic where the incident happened (anon chat / friend chat), if known.
    topic         TEXT,
    details       TEXT,
    -- 'open' | 'reviewing' | 'resolved' | 'dismissed'.
    status        TEXT        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','reviewing','resolved','dismissed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at   TIMESTAMPTZ
);

CREATE INDEX reports_reported_idx ON reports (reported_id);
CREATE INDEX reports_status_idx   ON reports (status);

-- ---------------------------------------------------------------------------
-- roulette_queue: users currently waiting for an anonymous match.
-- Postgres-backed (in-memory mirror lives in the process); Redis comes later.
-- ---------------------------------------------------------------------------
CREATE TABLE roulette_queue (
    id            BIGSERIAL   PRIMARY KEY,
    user_id       BIGINT      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    -- Matching filters captured at enqueue time.
    want_gender   TEXT        CHECK (want_gender IN ('male','female')),
    want_age_min  INT,
    want_age_max  INT,
    -- Higher = matched sooner. Paid tiers get priority (see subscriptions).
    priority      INT         NOT NULL DEFAULT 0,
    enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX roulette_queue_match_idx ON roulette_queue (priority DESC, enqueued_at ASC);

-- ---------------------------------------------------------------------------
-- subscriptions: monetization state (Premium / Super Premium + coins).
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     BIGINT      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    -- 'free' | 'premium' | 'super_premium'.
    tier        TEXT        NOT NULL DEFAULT 'free'
                            CHECK (tier IN ('free','premium','super_premium')),
    -- Coin balance for one-off purchases (queue priority, etc.).
    coins       BIGINT      NOT NULL DEFAULT 0,
    -- When the current paid tier expires; NULL for free.
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
