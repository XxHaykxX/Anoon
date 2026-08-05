-- 0007_media_assets.sql — mime/size tracking for media_assets (W3-9).
--
-- The frontend uploads files straight to Tinode's own handler
-- (POST /v0/file/u), not through companion, and gets back a ref like
-- "/v0/file/s/<id>". This migration only adds what 0004_moderation.sql's
-- media_assets table was missing to log that fact (POST /media/track):
-- the file's MIME type and byte size. Everything else it needs already
-- exists on that table under a different name — no rename, to avoid
-- touching the columns 0004 already wired into the admin API (§4):
--   * "ref"              -> the existing `url` column.
--   * "uploader_user_id" -> the existing `owner_id` column.
--   * "topic"/"created_at" -> unchanged, already present.
--
-- Both new columns are nullable so existing rows (there should be none yet,
-- but just in case) remain valid without a backfill.

ALTER TABLE media_assets ADD COLUMN mime TEXT;
ALTER TABLE media_assets ADD COLUMN size BIGINT;
