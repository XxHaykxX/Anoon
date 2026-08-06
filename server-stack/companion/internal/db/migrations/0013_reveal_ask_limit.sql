-- 0013_reveal_ask_limit.sql — two asks per person per match, then no more (#23).
--
-- A decline is deliberately not final: clearing reveal_by lets either side ask
-- again, which is what makes "not right now, maybe later" expressible. The cost
-- of that is a channel for pestering — nothing stopped one person re-asking for
-- the life of the chat. The route limiter bounds a fast loop but not a patient
-- one: a re-ask every few minutes stays under any per-second budget.
--
-- A COUNT is the right instrument here rather than a cooldown. Roulette chats
-- are short, so a time window either blocks a legitimate second ask or expires
-- before the chat does. "No means no" is a number of attempts, not a duration.
--
-- Counted per REQUESTER, not per match: being turned down twice spends YOUR
-- asks and leaves your peer's untouched. The person who declined can still ask
-- in their own right at any point — declining "not right now" and warming up
-- later is ordinary, and the pairing must not be closed off by their own
-- refusal. Exhaustion also blocks only ASKING; an exhausted user may still
-- accept a request their peer makes.
--
-- Two columns rather than a side table: a match has exactly two members and the
-- row already carries per-member fields (alias_a/alias_b), so this follows the
-- shape that is there. Read them through Match.DeclinesFor, which maps a user id
-- onto the right side.
ALTER TABLE roulette_matches
    ADD COLUMN reveal_declines_a SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN reveal_declines_b SMALLINT NOT NULL DEFAULT 0;
