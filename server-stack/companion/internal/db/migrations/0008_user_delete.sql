-- 0008_user_delete.sql — soft-delete support for DELETE /me (BE-10).
--
-- Self-service account deletion preserves the users row (deleted_at stamped,
-- not removed) so hash_id/#ID is never reused and reports/bans/
-- moderator_actions keep a valid target — moderation still sees the history.
-- Everything genuinely ephemeral (queue entry, push subscriptions, friend
-- links, linked oauth identity, monetization state) is hard-deleted instead;
-- see Store.DeleteUser for exactly what.

ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;

-- Partial index: only deleted accounts need to be found by this column, and
-- there should always be far fewer of those than live accounts.
CREATE INDEX users_deleted_idx ON users (deleted_at) WHERE deleted_at IS NOT NULL;
