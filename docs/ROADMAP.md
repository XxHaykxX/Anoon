# anoon — Roadmap (поэтапно)

> Разбивка [`../TODO.md`](../TODO.md) на фазы по зависимостям. Делать сверху вниз.
> Каждая фаза: цель · пункты · **критерий готовности (DoD)**. Фаза A независима от бэкенда.

---

## Фаза A — Быстрые победы web (без бэкенда) ✅ ГОТОВО (tsc/lint/build=0)
**Цель:** убрать реальные баги клиента, ничего не ждать.
- [x] persist `store/chat.ts` (zustand persist "anoon-chat") — история переживает reload;
      мёртвые blob-URL после reload → stale → плашка «Медиа недоступно» (message-bubble).
- [x] persist `store/moderation.ts` ("anoon-moderation") + метод `unblockPeer`.
- [x] enforce `isBlocked` в `chat/[id]/page.tsx` — `router.replace("/")` если peer заблокирован.
- [x] UI при `denied/unsupported`: баннер микрофона в composer; статус+ошибка push в `/settings`.
- [x] PNG-иконки PWA 192/512 (+maskable) — `web/scripts/gen-icons.mjs` (@resvg/resvg-js), manifest ок.
- [x] Экран `/settings`: смена ника (`setNickname`), push-статус, блоки+разблокировка, выход (reset); ссылка в хедере поиска.
- [x] `revokeObjectURL` неотправленного превью при размонтировании composer.

**DoD:** ✅ reload сохраняет чат/блоки; заблокированного не открыть; tsc/lint/build=0; роут /settings собран; иконки на месте.

---

## Фаза B — Фундамент данных ✅ ГОТОВО
**Цель:** реальная БД из общей схемы.
- [x] Поднять Postgres (Supabase, регион ap-southeast-1) для dev. Direct-хост IPv6-only →
      подключение через pooler (aws-1, session 5432 миграции / transaction 6543 рантайм).
- [x] Применить схему (`prisma db push` — вместо migrate, т.к. Supabase pooler без shadow-db).
      Добавлены модели Conversation/Message/Block. Таблицы созданы.
- [x] Сгенерировать Prisma-клиент, экспорт из `packages/db` (`index.ts` singleton).
- [x] Сидинг (`pnpm --filter @anoon/db seed`): 2 профиля, диалог+сообщения, жалоба, админ.
- [x] 🟠 RLS-политики применены (`packages/db/prisma/rls.sql`): RLS на всех 10 таблицах
      (deny-by-default), GRANT+policy `Profile` SELECT для authenticated; мутации — через
      backend secret (bypass RLS). Проверено (pg_policies/relrowsecurity).
- [ ] Перейти с `db push` на версионные миграции (baseline) перед прод.

**DoD:** ✅ схема в Supabase, клиент импортируется, seed прошёл, RLS включён.
**Backend SDK:** `@supabase/server` настроен в `backend/` (health=200, JWT-guard=401).

---

## Фаза C — Auth + клиент Supabase 🔴 (зависит от B) — Supabase-native
> Архитектура пивотнула на Supabase (`@supabase/server` + supabase-js). Вместо
> Bun+Hono+Socket.io: Supabase **Auth** (anonymous), **Realtime**, PostgREST.
> `backend/` (@supabase/server) — для привилегированных операций (secret-ключ).
**Цель:** анонимная сессия + клиент подключён.
- [x] supabase-js в `web`, `web/src/lib/supabase.ts` (browser-клиент, publishable-ключ).
- [x] `web/.env.local`: NEXT_PUBLIC_SUPABASE_URL + PUBLISHABLE_KEY + BACKEND_URL.
- [x] Анонимный вход (`supabase.auth.signInAnonymously`) в session store → JWT; фолбэк
      на локальный мок, если недоступно. Онбординг: async + «Входим…».
- [x] Апсерт Profile (User anonymous+providerId=uid, ник+#ID) — backend `POST /profile`
      (secret, supabaseAdmin). `web/src/lib/api.ts`.
- [x] DB-дефолты id/createdAt (`prisma/defaults.sql`) — чтобы PostgREST-вставки работали.
- [ ] ⚠️ ТРЕБУЕТСЯ юзер: включить **Anonymous sign-ins** в Supabase Auth (сейчас OFF →
      рантайм падает в фолбэк-мок). Код готов, tsc/lint/build=0.

**DoD:** код готов ✅. После тумблера: аноним-JWT + backend `/profile` создаёт Profile,
`/` под JWT отдаёт профили (RLS). Проверю сразу как включишь.

---

## Фаза D — Realtime чат + матчинг ✅ (broadcast проверен на publishable-ключе)
> Работает без anonymous auth (Broadcast/Presence на publishable-ключе). Идентичность —
> локальный #ID. Persist в БД (Message) — опционально позже; сейчас realtime-транспорт.
- [x] Матчинг «Найти»: lobby-presence Supabase Realtime (`lib/realtime.ts` findMatch),
      детерминированный инициатор; фолбэк-мок если не сконфигурено.
- [x] Чат: broadcast сообщений на канал `anoon:chat:<sorted pair>` (`joinChat`).
- [x] Presence-канал → реальный онлайн (зелёная точка/оффлайн в хедере).
- [x] `store/chat.ts` подключён к Realtime (connect/send/receive), мок-эхо убран.
- [x] Индикатор «печатает…» (broadcast typing из composer, debounce 1.5с).
- [x] Проверено: node-тест 2 клиента → broadcast доставлен (EXIT 0).
- [ ] Persist сообщений в таблицу Message (сейчас только realtime + localStorage). → позже.
- [ ] Статусы доставки/прочтения. → позже.

**DoD:** ✅ транспорт работает (broadcast/presence/typing), матчинг реализован. Полный
UI-тест 2 браузеров — вручную по чеклисту.

---

## Фаза E — Медиа через R2 🟠 (зависит от C)
**Цель:** медиа реально отправляются.
- [ ] R2-бакет + CORS + ключи.
- [ ] Presigned upload/download через бэкенд.
- [ ] `web`: заменить локальный object URL на реальную загрузку (фото/видео/голос).
- [ ] Ephemeral-очистка + `expiresAt`, состояние «медиа удалено».
- [ ] Медиа переживают reload (URL с сервера, не blob).

**DoD:** отправленное фото/видео/голос видит собеседник; открывается после reload.

---

## Фаза F — Модерация end-to-end 🟠 (частично: код готов)
**Цель:** блок/жалоба реальны, админка на живых данных.
- [x] backend `POST /block` (Block upsert) + `POST /report` (Report insert + reportCount++)
      через supabaseAdmin; резолв профилей по auth uuid / publicId; reason-маппинг.
- [x] `web`: `moderation` store шлёт block/report на backend при авторизованной сессии
      (иначе локально). `lib/api.ts` sendBlock/sendReport.
- [ ] admin: репойнт `dataProvider` mock→api (`NEXT_PUBLIC_DATA_MODE=api`).
- [ ] admin-auth реальный: `AdminUser`+argon2id+httpOnly+2FA+default-deny+rate-limit.
- [ ] admin: прокси медиа R2, двухпанельный detail жалоб.
- Примечание: рантайм block/report в БД активен только после anonymous auth (нужен JWT).

**DoD:** жалоба из web видна в очереди admin; бан из admin действует на юзера. (после auth+admin-api)

---

## Фаза G — Push-рассылка 🟡 (зависит от C)
**Цель:** уведомления реально приходят.
- [x] Сгенерировать VAPID-пару, public в web/.env.local, private в backend/.env.
- [ ] Хранить `PushSubscription` в БД (`POST /api/push/subscribe`).
- [ ] Рассылка через `web-push` при новом сообщении (когда получатель офлайн).
- [ ] Проверить secure-context (HTTPS) на реальном устройстве.

**DoD:** офлайн-юзер получает push о новом сообщении на телефоне.

---

## Фаза H — PWA-полиш + деплой 🟡
**Цель:** прод.
- [ ] PWA офлайн: precache/стратегия (Serwist) в `sw.js`.
- [ ] Деплой `web` (Vercel root=web) + env VAPID.
- [ ] Деплой `admin` (Vercel root=admin).
- [ ] Хостинг бэкенда v2 + WS (персистентный процесс, не serverless).
- [ ] CI: tsc+lint+build на push; секреты в env-хранилище.

**DoD:** прод-URL web/admin работают; бэкенд online; офлайн-режим базовый.

---

## Фаза I — Тесты / QA / a11y ⚪ (параллельно с F–H)
**Цель:** уверенность.
- [ ] Тест-план admin: auth guard/default-deny, RBAC, ban-каскад идемпотентно,
      mute на WS, аудит-полнота, lifecycle жалобы, PII-редакция.
- [ ] E2E web (Playwright): онбординг→поиск→чат→медиа→блок/жалоба.
- [ ] A11y-прогон (контраст AA, фокус, screen-reader).
- [ ] Реальное устройство: iOS Safari PWA + Android Chrome (standalone, safe-area, ≥44px).
- [ ] `docs/ui-test-checklist.md` — чеклист ручного UI-теста.

**DoD:** зелёный e2e; чеклист пройден на 2 реальных устройствах.

---

## Порядок и параллельность
```
A (сейчас, независима)
B → C → D → F
        C → E → F
        C → G
H после D/E/F/G · I параллельно с F–H
```
**Рекомендация:** начать с **Фазы A** (автономна, быстро), параллельно **Фаза B** (фундамент).
