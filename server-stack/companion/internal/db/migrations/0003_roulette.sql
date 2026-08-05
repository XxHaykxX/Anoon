-- 0003_roulette.sql — roulette match records + reveal state.
--
-- The roulette_queue (0001) holds who is *waiting*; this table records an
-- *established* anonymous pairing so the companion can drive end/rating/reveal
-- and know which two real accounts sit behind an anon topic.
--
-- Reveal is a two-step mutual handshake: one side requests (reveal_by set to
-- their user id), the other accepts (status -> 'revealed'). On reveal the pair
-- also becomes friends (friendships row, source 'reveal').

CREATE TABLE roulette_matches (
    id          BIGSERIAL   PRIMARY KEY,
    -- Tinode group topic backing the anon chat (e.g. "grpAbC123"). Unique.
    topic       TEXT        UNIQUE NOT NULL,
    -- The two paired accounts (companion user ids). user_a < user_b not enforced;
    -- order is just "who was A/B at match time".
    user_a      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 'active'   : chat ongoing (anon)
    -- 'ended'    : either side ended it
    -- 'revealed' : mutual reveal done, now a friend chat
    status      TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','ended','revealed')),
    -- User id that requested reveal (NULL until someone asks). The other side's
    -- accept flips status to 'revealed'.
    reveal_by   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at    TIMESTAMPTZ
);

CREATE INDEX roulette_matches_user_a_idx ON roulette_matches (user_a);
CREATE INDEX roulette_matches_user_b_idx ON roulette_matches (user_b);

-- Prevent re-matching the same pair back-to-back: the matcher consults recent
-- partners to populate its per-entry Exclude set. Indexed by both members.
CREATE INDEX roulette_matches_recent_idx ON roulette_matches (created_at DESC);
