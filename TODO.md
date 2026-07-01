# anoon — TODO (что не сделано)

> Монорепо: `web/` (клиент-PWA), `admin/` (модерация), `backend/` (@supabase/server),
> `packages/db` (общая Prisma-схема). Дата среза: 2026-07-01.
> Легенда приоритета: 🔴 блокер · 🟠 важно · 🟡 желательно · ⚪ потом.
> Статус: web-фичи + backend persist/push/rate-limit + admin auth/data (код) закрыты
> (tsc/lint/build=0, e2e зелёный). Осталось — инфра/данные от юзера. Прогресс: `docs/ROADMAP.md`.
>
> ⚠️ **Окружение:** папка переименована `anoon Expo` → `anoon Chat`; pnpm-symlink'и были
> битые — переустановлены зависимости (`CI=true pnpm install`) во всех пакетах.

---

## 0. Бэкенд (Supabase-native) 🔴

- [x] 🔴 Backend-каркас: `backend/` с `@supabase/server` (health=200, JWT-guard=401).
- [x] 🔴 Общая БД `packages/db` (схема+клиент+seed+RLS+DB-дефолты).
- [~] 🔴 Аутентификация юзера — код готов; ЖДЁТ включения Anonymous sign-ins в Supabase.
- [x] 🔴 Realtime чат (broadcast) + матчинг (lobby-presence) + presence-онлайн.
- [x] 🔴 **Persist сообщений** в Message/Conversation: backend `POST/GET /messages`
      (find-or-create Conversation, kind-маппинг voice→audio); web `store/chat.ts` шлёт
      + гидратирует историю при пустом local.
- [x] 🔴 **Статусы доставки/прочтения**: MessageStatus + realtime read-receipt
      (`sendRead`/`onRead`) + `POST /messages/read`; тики ✓/✓✓ в message-bubble.
- [x] 🟠 Модерация block/report → backend в БД (Block/Report).
- [x] 🟠 **Push**: модель `PushSubscription` (+RLS/defaults), backend
      `POST/DELETE /push/subscribe`, рассылка `web-push` при офлайн-получателе;
      web шлёт подписку с токеном. ⚠️ рантайм — после anon-auth + таблицы в БД.
- [x] 🟡 **Rate-limit / антифлуд**: sliding-window на `/messages` (30/10с),
      `/report` (10/60с), `/block` (20/60с), login-limit в admin.
- [ ] 🟡 Голосовые: транскод/нормализация (или as-is).

---

## 1–3. web — баги + фичи ✅

- [x] Все баги Фазы A (persist, isBlocked, revokeObjectURL и т.д.).
- [x] 🟠 **Кнопка «Установить приложение»** (`install-pwa.tsx`): beforeinstallprompt
      (Android) + iOS-подсказка «Поделиться → На экран Домой»; скрыта в standalone.
- [x] 🟡 **Мультипревью медиа** + индикатор отправки (composer: массив pending).
- [x] 🟡 **Голосовые: реальный waveform** (декод blob → пики) + seek по клику.
- [x] 🟡 **Лайтбокс**: pinch-zoom + pan + свайп/стрелки между медиа диалога.
- [x] ⚪ **Эмодзи-пикер, ответы (reply+цитата), удаление своего сообщения**
      (realtime `delete`-broadcast).
- [x] 🟡 PWA офлайн (sw.js), иконки, typing, /settings.
- [ ] 🟡 Медиа реально отправляются — ЖДЁТ R2 (Фаза E, ключи от юзера).

---

## 2. web — ограничения окружения 🟠

- [ ] 🔴 Голос/Push требуют HTTPS (secure-context) — тест на localhost/туннель.
      [x] UI-сообщение при denied/unsupported.
- [ ] 🟠 `NEXT_PUBLIC_VAPID_PUBLIC_KEY` в web/.env — public-ключ пары (private в backend/.env).
- [ ] 🟡 Liquid Glass: полная рефракция только Chrome/Edge (by-design).

---

## 4. admin ✅ (код)

- [x] 🟠 **Реальный admin-auth**: AdminUser+argon2id (`@node-rs/argon2`) + httpOnly-cookie
      (jose HS256) + 2FA TOTP (свой RFC6238, `lib/totp.ts`) + login rate-limit +
      middleware default-deny. Route handlers `app/api/auth/{login,logout,me}`.
      Скрипт `scripts/create-admin.mjs`.
- [x] 🟠 **dataProvider mock→api** (`NEXT_PUBLIC_DATA_MODE=api`): route handlers
      `app/api/admin/[resource]` через Supabase secret; репо с явными JS-джойнами;
      каскад бана (Ban+ModeratorAction) при resolve.
- [x] 🟡 **Двухпанельный detail-вид жалоб** (список слева + детали/медиа/действия справа).
- [ ] ⚠️ **Рантайм** admin api-режима: заполнить `admin/.env` (SUPABASE_URL,
      SUPABASE_SECRET_KEY, ADMIN_SESSION_SECRET), создать админа скриптом.
- [ ] 🟡 Прокси медиа R2 (сейчас url пустой без R2).
- [ ] ⚪ Роль `moderator` (сейчас super-admin).

---

## 5. packages/db ✅

- [x] Схема (+ `PushSubscription`), клиент, seed, RLS, DB-дефолты.
- [x] 🟡 **Baseline-миграция** `prisma/migrations/0_init` (+ README как принять на живой БД).
- [ ] 🟡 Принять baseline на живой БД (`migrate resolve --applied 0_init`) — ЖДЁТ DB-доступа.

---

## 6. Инфра / деплой 🟡

- [x] 🟡 **CI**: `.github/workflows/ci.yml` — tsc+lint+build для web/admin, typecheck
      backend, generate db (per-package, без корневого workspace).
- [ ] 🟠 Деплой web/admin на Vercel + env. (ЖДЁТ GitHub+Vercel)
- [ ] 🟠 Хостинг backend + R2-бакет + ключи. (ЖДЁТ ключей)
- [x] 🟡 Секреты в `.env` (gitignored). ⚠️ ЮЗЕРУ: ротировать засвеченные в чате.

---

## 7. Тесты / QA / a11y

- [x] 🟡 **E2E прогнан** (Playwright chromium): онбординг, чат, эмодзи, reply, delete —
      7 passed. Добавлен `chat-features.spec.ts`.
- [x] 🟡 **A11y-скан** (`@axe-core/playwright`): онбординг+чат — 0 serious/critical;
      label-ассоциации, aria-label, aria-live добавлены.
- [ ] 🟡 Реальное устройство (iOS Safari PWA, Android Chrome).

---

## Статус на 2026-07-01 (обновлено)

СДЕЛАНО (задеплоено на прод, проверено Playwright):
- [x] ✅ Anonymous sign-ins ВКЛ; profile-синк работает (баг null-id вставок исправлен — `id: crypto.randomUUID()`).
- [x] ✅ Деплой web+admin на Vercel; admin/.env заполнен; админ создан; DATA_MODE=api.
- [x] ✅ Медиа — через **Supabase Storage** (bucket `media`), не R2. Фото/видео/голос доходят+играют.
- [x] ✅ Одноразовое медиа, read-receipts, recording-индикатор, завершение+оценка, автоскролл.
- [x] ✅ Admin: файл-менеджер, общая галерея `/gallery` (+#ID), онлайн по полу `/online`, история+живые чаты `/chats`, мобильная навигация, PWA админки, респонсив.
- [x] ✅ **Энфорс бана**: забаненный не шлёт сообщения (403 `/api/messages`) + оверлей «Доступ заблокирован» (флаг из heartbeat `/api/presence`); разбан авто-снимается; временный бан авто-истекает (`activeBan`).

ОСТАЛОСЬ (опционально, ⚪ низкий приоритет / никто не просил):
- [ ] ⚪ Роль `moderator` (сейчас только super-admin).
- [ ] ⚪ Mute (mutedUntil) — модели/UI нет.
- [ ] ⚪ Голосовые: транскод/нормализация (сейчас as-is, работает).
- [ ] 🟡 Версионные миграции вместо `db push` перед масштабированием.

⚠️ ТОЛЬКО ОТ ЮЗЕРА (безопасность):
- [ ] Ротировать засвеченные в чате секреты: Vercel-токен, SUPABASE_SECRET_KEY, DB-пароль.
