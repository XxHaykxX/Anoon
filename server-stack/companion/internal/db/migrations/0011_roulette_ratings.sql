-- 0011_roulette_ratings.sql — one rating per rater per match (S3).
--
-- POST /roulette/rate checked membership, which is the right authorisation, but
-- it authorised "you were in this chat" while performing an unbounded
-- `rating_sum = rating_sum + $2, rating_count = rating_count + 1`. There was no
-- ledger, no uniqueness constraint and no status check, and MatchByTopic has no
-- status filter (deliberately — the reporting path needs ended matches), so any
-- past peer could replay the call in a loop and drive a victim's average to 1.0,
-- for a match that ended weeks ago.
--
-- The fix is to make the rating a FACT about a (match, rater) pair rather than
-- an increment: the primary key below means a replay overwrites its own row
-- instead of accumulating, and the running totals on users are recomputed from
-- this table (store.RateMatch) rather than added to.
CREATE TABLE roulette_ratings (
    match_id   BIGINT      NOT NULL REFERENCES roulette_matches(id) ON DELETE CASCADE,
    -- Who rated. rated_id is denormalized from the match so the per-user
    -- recompute is a single indexed lookup and survives the match being pruned
    -- for any reason other than CASCADE.
    rater_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rated_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The constraint that makes the endpoint idempotent. One rater, one match,
    -- one rating.
    PRIMARY KEY (match_id, rater_id),
    -- Rating yourself was never possible through the handler; stated here so it
    -- cannot become possible through a future one.
    CHECK (rater_id <> rated_id)
);

CREATE INDEX roulette_ratings_rated_idx ON roulette_ratings (rated_id);

-- The existing users.rating_sum / rating_count are the totals this table now
-- derives. They are reset rather than migrated: there is no per-rating history
-- to rebuild them from, and any of them may already contain replayed increments
-- (nothing reads these columns today — they are written and never selected — so
-- the reset costs nothing, and leaving them would mean the totals permanently
-- disagreed with the ledger that is now their source of truth).
UPDATE users SET rating_sum = 0, rating_count = 0 WHERE rating_sum <> 0 OR rating_count <> 0;
