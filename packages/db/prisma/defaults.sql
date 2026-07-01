-- anoon — DB-уровневые дефолты для id и createdAt.
-- Prisma @default(cuid())/@default(now()) генерируются на стороне приложения (Prisma Client),
-- а НЕ в БД. Значит вставки через PostgREST / @supabase/server (supabaseAdmin) без явных
-- id/createdAt падали бы (NOT NULL). Ставим DB-дефолты: id = uuid, createdAt = now().
-- Prisma-вставки продолжат работать (передают свои значения, перекрывая дефолт).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User','Profile','Report','Ban','AdminUser','ModeratorAction',
    'MediaAsset','Conversation','Message','Block','PushSubscription'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "createdAt" SET DEFAULT now()', t);
  END LOOP;
END $$;
