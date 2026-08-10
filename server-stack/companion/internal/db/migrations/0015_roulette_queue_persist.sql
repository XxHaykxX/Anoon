-- 0015_roulette_queue_persist.sql — make the roulette queue survive a restart.
--
-- Until now the queue lived only in matchmaker.Matcher's maps: a companion
-- restart emptied it and everyone waiting was silently dropped. The client
-- papered over that by re-sending enqueue from its /roulette/status poller,
-- which only works while a client is alive — close the tab (or background the
-- phone) and the wait was lost for good.
--
-- 0001 already shipped a roulette_queue table for exactly this job, but it was
-- never written to by any code path and its columns describe a matcher that
-- does not exist: want_gender / want_age_min / want_age_max. The real engine
-- pairs on auto-opposite gender plus UI age *buckets* ("18-21", "36+"), so
-- there is nothing in the old shape to migrate — it is provably empty (the only
-- statement that ever mentioned it is a DELETE in DeleteUser). Recreate it in
-- the shape the engine actually has.
--
-- What is persisted is deliberately only what cannot be recomputed:
--   * age_range / peer_age_ranges — chosen by the user at enqueue time, they
--     exist nowhere else;
--   * enqueued_at — drives both fairness ordering and the softening clock, so
--     restoring with now() would push every waiter back to the end of the line.
-- Gender and hash_id are joined from users; priority (subscription tier) and
-- the exclude set (recent partners + blocks) are re-derived on restore from
-- the same store calls the enqueue handler uses — cheaper than keeping a
-- denormalized copy correct, and it picks up anything that changed while the
-- process was down.
--
-- No index: the matching hot path never reads this table. Pairing runs against
-- the in-memory (gender, age) buckets; these rows are touched once per enqueue,
-- once per cancel/match, once at startup, and by the stale sweep. Adding an
-- index here would only be write cost for reads that never happen.
DROP TABLE roulette_queue;

CREATE TABLE roulette_queue (
    -- One row per waiter; PRIMARY KEY gives the enqueue upsert its conflict
    -- target and mirrors the matcher's own "one entry per user" rule.
    user_id         BIGINT      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- The waiter's own UI age bucket (matchmaker.ValidAgeRanges).
    age_range       TEXT        NOT NULL,
    -- Desired peer buckets, comma-joined; empty string means "any age". A TEXT
    -- list rather than TEXT[] because the buckets are a fixed, comma-free token
    -- set and database/sql over pgx handles a plain string without any array
    -- codec ceremony.
    peer_age_ranges TEXT        NOT NULL DEFAULT '',
    -- Original queue-entry time, NOT the row's write time: it is the fairness
    -- order and the softening clock, and both must survive the restart.
    enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
