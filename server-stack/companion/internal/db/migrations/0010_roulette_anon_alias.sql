-- 0010_roulette_anon_alias.sql — per-match pseudonyms for the anon phase (H2).
--
-- Before this, the `matched` event and GET /roulette/status handed each side the
-- peer's real, permanent, public #ID — the same identifier /me returns and
-- /friends/search looks up — at the moment of pairing, i.e. BEFORE any reveal.
-- Either side could read it off the screen and add/block/report/find the other
-- person with no reveal and no consent, which routed straight around the
-- server-side anonymity patch (server-stack/ANON-PATCH.md).
--
-- Each match now carries one alias per member. The alias identifies that member
-- to their peer for the lifetime of this match and nothing else:
--   * it is random, so it does not encode the #ID and cannot be reversed;
--   * it is per-match, so the same person is a different alias next time and is
--     not recognisable as a returning peer;
--   * it is stable, so the `matched` event and the /roulette/status resync path
--     agree (the recovery path breaks otherwise).
--
-- Public form is "~" + 6 chars, deliberately unlike the real "#00012" so the UI
-- can never be mistaken for showing a real #ID. Go writes both values explicitly
-- on INSERT (store.CreateMatch); the DEFAULT below is the safety net for any row
-- created without them.

-- ---------------------------------------------------------------------------
-- roulette_anon_alias: the ONE generator for a stored alias. It backs both the
-- backfill and the column DEFAULT, so there is no second implementation to
-- drift out of step.
--
-- The alphabet must match store.aliasAlphabet exactly —
-- "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", which deliberately omits I, O, 0 and 1 as
-- ambiguous when read off a screen or dictated into a moderation report. That
-- matters here because store.NormalizeAlias validates against it and REJECTS
-- anything else: an alias this migration wrote but the application then refuses
-- to parse is not a cosmetic mismatch, it is a row whose peer can never be
-- resolved (MatchByPeerAlias returns ErrNoMatch), so alias-addressed call and
-- activity frames silently fail for that match — intermittently, and with
-- nothing to connect the symptom back to a migration.
--
-- md5() is hex, so its output is NOT such an alphabet: it contains 0 and 1, and
-- a naive '~' || upper(substr(md5(...), 1, 6)) yields a value the application
-- rejects roughly 55% of the time ((14/16)^6 survive). translate() maps all 16
-- hex symbols onto 16 alphabet symbols, so every character is in range by
-- construction and the result always round-trips NormalizeAlias. Both arguments
-- are 16 characters and cover the whole hex set — a symbol missing from the
-- source list would pass through unmapped and reintroduce the bug.
--
-- VOLATILE is required, not decorative: ALTER TABLE ADD COLUMN evaluates a
-- volatile default once PER ROW (rewriting the table), which is what gives
-- pre-0010 rows distinct aliases rather than one value shared by all of them.
CREATE OR REPLACE FUNCTION roulette_anon_alias() RETURNS TEXT AS $$
    SELECT '~' || translate(
        upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
        '0123456789ABCDEF',
        'ABCDEFGHJKLMNPQR'
    );
$$ LANGUAGE sql VOLATILE;

ALTER TABLE roulette_matches
    ADD COLUMN alias_a TEXT NOT NULL DEFAULT roulette_anon_alias(),
    ADD COLUMN alias_b TEXT NOT NULL DEFAULT roulette_anon_alias();

-- Two independent draws can in principle land on the same value (1 in 16^6).
-- Redraw before the constraint below turns that into an error. store.CreateMatch
-- makes the same retry on the values it inserts itself.
UPDATE roulette_matches SET alias_b = roulette_anon_alias() WHERE alias_a = alias_b;

-- The two members of one match must be tellable apart — an identical pair would
-- make a moderation record ambiguous about which of them did what. Stated as a
-- constraint rather than trusted to the generators on both sides.
ALTER TABLE roulette_matches
    ADD CONSTRAINT roulette_matches_alias_distinct CHECK (alias_a <> alias_b);
