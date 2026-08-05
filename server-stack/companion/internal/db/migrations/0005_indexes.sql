-- 0005_indexes.sql — performance indexes for hot admin/presence/moderation
-- lookups (PERF-2). Only indexes MISSING after 0001–0004 are added; existing
-- ones are intentionally NOT duplicated. All use CREATE INDEX IF NOT EXISTS so
-- the migration is safe to re-run and safe if an index was added out of band.
--
-- Deliberately SKIPPED (already indexed by 0001–0004):
--   * friendships(user_id, friend_id) — covered by UNIQUE (user_id, friend_id) (0001).
--   * friendships(friend_id)          — covered by friendships_friend_idx (friend_id, status) (0001).
--   * reports(status)                 — reports_status_idx (0001).
--   * oauth_identities(provider,subject) lookup key — UNIQUE (provider, subject) (0002).
--   * users(hash_id) unique           — already UNIQUE NOT NULL on the column (0001).

-- users.last_seen: presence window scans in Overview (online counts) and
-- OnlineUsers (WHERE last_seen >= $1 ORDER BY last_seen DESC). No index existed.
CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users (last_seen);

-- bans: the active-ban check filters status AND compares expires_at
-- (Overview: status='active' AND (expires_at IS NULL OR expires_at > now())).
-- bans_status_idx (0004) covers status alone; this composite also serves the
-- expiry comparison used to auto-lapse temporary bans.
CREATE INDEX IF NOT EXISTS bans_status_expires_idx ON bans (status, expires_at);

-- roulette_matches.status: lifecycle filters (active/ended/revealed). 0003 only
-- indexed topic/user_a/user_b/created_at, so status lookups were unindexed.
CREATE INDEX IF NOT EXISTS roulette_matches_status_idx ON roulette_matches (status);
