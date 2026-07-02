-- Реальные аккаунты + раскрытие/друзья (аддитивно, не ломая прод).
-- 'email' в AuthProvider уже добавлен миграцией 20260702000001_accounts_enum.

-- Новые enum-типы
CREATE TYPE "ConversationKind" AS ENUM ('roulette', 'friend');
CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted');

-- supabaseUserId: nullable → backfill → unique (НЕ одним шагом, иначе падает на живых данных).
-- Провайдер-агностичная связь с Supabase uid (сегодня uid = providerId для всех строк).
ALTER TABLE "User" ADD COLUMN "supabaseUserId" TEXT;
UPDATE "User" SET "supabaseUserId" = "providerId" WHERE "supabaseUserId" IS NULL;
-- unique в Postgres допускает несколько NULL — безопасно, даже если бэкфилл кого-то пропустил.
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");

-- Профиль: имя/фамилия/аватар/возраст + блокировка пола.
ALTER TABLE "Profile" ADD COLUMN "firstName" TEXT;
ALTER TABLE "Profile" ADD COLUMN "lastName" TEXT;
ALTER TABLE "Profile" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "Profile" ADD COLUMN "ageBand" TEXT;
ALTER TABLE "Profile" ADD COLUMN "genderLocked" BOOLEAN NOT NULL DEFAULT false;

-- Дискриминатор диалога. legacy → roulette.
ALTER TABLE "Conversation" ADD COLUMN "kind" "ConversationKind" NOT NULL DEFAULT 'roulette';
-- Рулетка эфемерна (новая строка на матч) → БЕЗ уникальности пары.
-- Уникальна ТОЛЬКО личка друзей (канонический порядок пары при создании):
CREATE UNIQUE INDEX "Conversation_friend_pair_key" ON "Conversation"("profileAId", "profileBId") WHERE "kind" = 'friend';

-- Раскрытие=дружба — единый источник правды.
-- DB-дефолт id = gen_random_uuid()::text (защита от бага #38: cuid не создаёт DB-дефолт;
-- пишем через supabase-js, поэтому для НОВОЙ таблицы полагаемся на DB-дефолт, а не на app-код).
CREATE TABLE "Friendship" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "loId" TEXT NOT NULL REFERENCES "Profile"("id") ON DELETE CASCADE,
  "hiId" TEXT NOT NULL REFERENCES "Profile"("id") ON DELETE CASCADE,
  "requestedById" TEXT NOT NULL,
  "status" "FriendshipStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Friendship_loId_hiId_key" ON "Friendship"("loId", "hiId");
CREATE INDEX "Friendship_hiId_status_idx" ON "Friendship"("hiId", "status");
CREATE INDEX "Friendship_loId_status_idx" ON "Friendship"("loId", "status");

-- nextPublicId — гонка (ревью раздел B): count(Profile)+1 под параллельной регистрацией
-- даёт одинаковый #ID → падение на unique. С реальными аккаунтами регистраций больше.
-- Атомарный SEQUENCE снимает гонку; стартуем со значения после уже существующих профилей.
CREATE SEQUENCE IF NOT EXISTS "profile_public_seq";
-- is_called=(count>0): при непустой таблице nextval вернёт count+1; при пустой — 1 (00001).
SELECT setval('profile_public_seq', GREATEST((SELECT COUNT(*) FROM "Profile"), 1), (SELECT COUNT(*) FROM "Profile") > 0);
