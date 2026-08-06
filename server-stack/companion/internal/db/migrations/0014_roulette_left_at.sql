-- 0014_roulette_left_at.sql — record when a member walks out of a chat (#24).
--
-- Until now nothing ever ended a REVEALED match. EndMatch and
-- EndActiveMatchesForUser both filter `status = 'active'`, and leaving a
-- revealed chat wrote nothing at all — the pair simply keep using that grp
-- topic as friends. So the row stayed non-ended forever and
-- CurrentMatchForUser kept reporting it as the caller's "current" match long
-- after they walked away, which is what GET /roulette/status answered every
-- poll with. The frontend papered over it with a guard (branch on `reveal`,
-- never on `match != null`), but that guard is a client-side courtesy: the
-- native client will not have it, and the server was simply reporting
-- something untrue.
--
-- Ending the row is NOT the fix, and this migration deliberately does not do
-- it: Match.Anon() keys off status, so an ended-but-revealed match would start
-- naming two friends by their anon aliases again in every relay. The status
-- must stay 'revealed' — what is missing is *who is still in the room*.
--
-- Hence per-member timestamps, in the same two-column shape the row already
-- uses for its other per-member fields (alias_a/alias_b, reveal_declines_a/b).
-- Read them through Match.LeftFor / mark them through Store.LeaveMatch, which
-- map a user id onto the right side.
--
-- NULL means "still in it", which makes every pre-existing row read as present
-- — the safe default: a stale row now gets cleared the first time that user
-- actually leaves or re-enqueues, rather than being retroactively guessed at.
ALTER TABLE roulette_matches
    ADD COLUMN left_a TIMESTAMPTZ,
    ADD COLUMN left_b TIMESTAMPTZ;
