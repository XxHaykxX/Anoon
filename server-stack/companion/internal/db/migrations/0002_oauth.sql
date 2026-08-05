-- 0002_oauth.sql — OAuth identity mapping + pending registration data.
--
-- Google sign-in goes through Tinode's `rest` auth scheme: the account is
-- created by Tinode, which then calls companion's /auth/rest `link` endpoint
-- with the new UID. At that point we have the UID but not the anoon business
-- data (gender/age) chosen in the app — so the broker step captures it into
-- pending_registrations keyed by the OAuth subject, and `link` consumes it.

-- ---------------------------------------------------------------------------
-- oauth_identities: external identity (provider + subject) -> anoon user.
-- One user may have several (google, apple, ...); one identity maps to one user.
-- ---------------------------------------------------------------------------
CREATE TABLE oauth_identities (
    id          BIGSERIAL   PRIMARY KEY,
    -- 'google' | 'apple' | 'facebook'.
    provider    TEXT        NOT NULL,
    -- Stable provider-side user id (Google "sub" claim). Never reused.
    subject     TEXT        NOT NULL,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
);

CREATE INDEX oauth_identities_user_idx ON oauth_identities (user_id);

-- ---------------------------------------------------------------------------
-- pending_registrations: gender/age captured at the broker step, held until
-- Tinode creates the account and calls `link`. Short-lived; a periodic sweep
-- can drop stale rows (a signup abandoned before the rest login completes).
-- ---------------------------------------------------------------------------
CREATE TABLE pending_registrations (
    provider    TEXT        NOT NULL,
    subject     TEXT        NOT NULL,
    gender      TEXT        NOT NULL CHECK (gender IN ('male', 'female')),
    age         INT         CHECK (age IS NULL OR (age BETWEEN 13 AND 120)),
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
