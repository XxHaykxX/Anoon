-- anoon — RLS-политики (Фаза B/security).
-- Модель: клиент (anon/authenticated через @supabase/server ctx.supabase) читает по RLS;
-- ВСЕ мутации и приватное чтение — через backend ctx.supabaseAdmin (secret-ключ, bypass RLS).
-- Идемпотентно: DROP POLICY IF EXISTS перед CREATE.

-- 1) Доступ к схеме для клиентских ролей.
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2) Включить RLS на всех таблицах (deny-by-default — без политики никто из клиентов не читает).
ALTER TABLE "User"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Profile"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Report"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ban"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminUser"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ModeratorAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaAsset"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Block"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;

-- 3) Форсить RLS даже для владельца таблицы (кроме BYPASSRLS-ролей, коими являются
--    postgres/service_role) — чтобы обычные подключения не обходили политики.
ALTER TABLE "Profile" FORCE ROW LEVEL SECURITY;

-- 4) Отобрать «широкие» гранты у клиентских ролей (на случай дефолтных привилегий Supabase),
--    затем выдать только нужное. Приватные/админ-таблицы клиенту недоступны совсем.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- 5) Profile: аутентифицированный юзер видит публичные профили (discovery для чата).
--    Ограничение колонок (не отдавать userId и пр.) делаем на уровне выборки/вью позже;
--    RLS даёт доступ к строке, backend/клиент выбирает только публичные поля.
GRANT SELECT ("id", "publicId", "nickname", "emoji", "online", "lastSeen") ON "Profile" TO authenticated;

DROP POLICY IF EXISTS profile_select_authenticated ON "Profile";
CREATE POLICY profile_select_authenticated
  ON "Profile" FOR SELECT
  TO authenticated
  USING (true);

-- Остальные таблицы (User/Report/Ban/AdminUser/ModeratorAction/MediaAsset/
-- Conversation/Message/Block): RLS включён, клиентских политик НЕТ → полный deny для
-- anon/authenticated. Обслуживаются backend-ом через secret-ключ (bypass RLS).
-- TODO(Фаза D): когда свяжем Supabase auth.uid() ↔ Profile, добавить политики
--   Conversation/Message «участник видит свой диалог» и Realtime-подписки.
