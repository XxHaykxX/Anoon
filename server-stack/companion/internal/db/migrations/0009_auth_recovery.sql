-- 0009_auth_recovery.sql — password reset + email verification (#116).
--
-- Adds the columns and token ledger the account-recovery / email-verification
-- flows need. The email SEND itself is SMTP-stubbed for now (internal/mail);
-- this migration only provides the durable state.
--
-- users extensions:
--   * email          — the account's contact email. For basic (login/password)
--                      accounts it is captured at registration (optional); for
--                      Google accounts the verified email lives in
--                      oauth_identities.email, so this may stay NULL there.
--   * email_verified — whether the user confirmed their email via the verify
--                      flow (POST /auth/verify-email/confirm).
--   * login          — the basic-scheme username the account was created with.
--                      Stored so a password reset can re-issue the Tinode basic
--                      secret ("login:newpassword") as ROOT. NULL for Google
--                      accounts (no password) and for pre-#116 basic accounts.
ALTER TABLE users ADD COLUMN email          TEXT;
ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN login          TEXT;

CREATE INDEX users_email_idx ON users (lower(email));
CREATE INDEX users_login_idx ON users (lower(login));

-- ---------------------------------------------------------------------------
-- auth_tokens: single-use, expiring tokens for both recovery flows. purpose
-- discriminates password reset from email verification. A row is spent when
-- used_at is set; expiry is enforced in the store, not by a constraint, so an
-- expired-but-unused token is still auditable.
--   * purpose    — 'reset' (password reset) | 'verify' (email verification).
--   * email      — the address the token was mailed to (denormalized for the
--                  reset lookup + audit; may differ from users.email over time).
-- ---------------------------------------------------------------------------
CREATE TABLE auth_tokens (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     BIGINT      REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT        NOT NULL CHECK (purpose IN ('reset', 'verify')),
    token       TEXT        NOT NULL UNIQUE,
    email       TEXT,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_purpose_idx ON auth_tokens (purpose, token);
