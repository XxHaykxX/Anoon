# anoon — состояние проекта (для компакта/хендоффа)

> Снимок на момент активной разработки. Живой прод + монорепо. Обновляется по ходу.

## Что это
Анонимный чат-рулетка (18+). Монорепо:
- `web/` — Next.js 16 PWA (клиент + co-located backend в `app/api/*` route handlers).
- `admin/` — Next.js 16 админка модерации (Refine) + свои route handlers + Supabase secret.
- `backend/` — standalone `@supabase/server` (dev-референс; в проде НЕ используется — перенесён в web).
- `packages/db` — общая Prisma-схема (Supabase Postgres).

## Прод (живое)
- web: **https://anoon-web.vercel.app**
- admin: **https://anoon-admin.vercel.app** (логин `admin@anoon.app` / пароль `lVRmXO6cb6i4`, 2FA off)
- GitHub: **https://github.com/XxHaykxX/Anoon** (main). Деплой — через `vercel` CLI (НЕ git-triggered).
- Vercel scope: `karapetyanhaykoooo-8237s-projects` (team_lbj2OCxIjG0oVIR8w0x1GKhD). SSO-protection off у обоих проектов.
- ⚠️ Vercel-токен светился в чате — ЮЗЕРУ отозвать после деплоев.

## Инфра/конфиг
- Supabase проект `acepsafoeihfrgbzrbif` (ap-southeast-1). **Anonymous sign-ins ВКЛючены**.
- Env (gitignored): `web/.env.local`, `admin/.env`, `backend/.env`, `packages/db/.env`. Значения Supabase URL/secret + VAPID в них.
- Admin env: SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_SESSION_SECRET, NEXT_PUBLIC_DATA_MODE=api. Web env: NEXT_PUBLIC_SUPABASE_* + SUPABASE_SECRET_KEY + VAPID_* (server).
- БД применена через `prisma db push`. Baseline-миграция `0_init` есть. Bucket Storage `media` (приватный).
- ⚠️ Секреты (SUPABASE_SECRET_KEY, DB-пароль) светились в чате — ротировать.

## Архитектура (ключевое)
- **Auth:** аноним Supabase (`signInAnonymously`) → JWT. `session.ts` оптимистичный + `ensureProfile()` досинхрон.
  Профиль в БД (User provider=anonymous+providerId=uid → Profile publicId/nickname). Если синк не прошёл (synced=false) — медиа/backend падают.
- **Realtime:** Supabase Broadcast/Presence. Канал диалога `anoon:chat:<sorted pair>`. События: msg/typing/recording/delivered/read/delete/viewed/end. Матчинг — lobby-presence с фильтрами пол+возраст, фолбэк 8с.
- **Медиа:** Supabase Storage bucket `media`, путь `{profileId}/{uuid}.ext`. web/api/media/create-upload → signed upload URL + MediaAsset; клиент грузит напрямую (обход 4.5МБ). download → signed URL 1ч. chat.ts: placeholder-broadcast → аплоад → broadcast готового URL.
- **Backend в web:** `web/src/lib/server/backend.ts` (supabase secret + getUid по JWT + web-push + rate-limit). Роуты `web/app/api/`: profile, messages(GET/POST), messages/read, push/subscribe, block, report, rate, media/create-upload, media/download.
- **Admin:** `admin/src/lib/supabase-admin.ts` (secret). Auth: argon2id (`@node-rs/argon2`) + jose HS256 cookie + TOTP (`lib/totp.ts` свой RFC6238) + `proxy.ts` (Next16, default-deny) + login rate-limit. Данные: `api-data-provider` + `/api/admin/[resource]` + `/api/admin/media`. Скрипт `admin/scripts/create-admin.mjs`.

## Готово (задеплоено, протестировано 2-девайс/мобильно)
- Онбординг, матчинг по фильтрам (пол Некто/М/Ж + возраст 18-21/22-25/26-35/36+, 18+ гейт), пульс-поиск + отмена.
- Realtime-чат: текст (порядок верный, хронологический), typing, presence-онлайн, recording-индикатор «записывает голос…».
- Статусы: ✓ sent · ✓✓ delivered (серые) · ✓✓ read (СИНИЕ) — на всех типах.
- Reply/цитата, удаление своего, эмодзи-пикер. Респонсив (break-words, composer min-w-0).
- Медиа Storage: фото/голос/видео доходят+воспроизводятся (в норме; см. БАГ #38). Лайтбокс pinch/свайп. Voice waveform+seek.
- Завершение разговора → модалка «завершён» + оценка смайликами (1..5) → `Profile.ratingSum/ratingCount` (trust против фейков).
- Push (VAPID) subscribe + web-push офлайн-рассылка. PWA/install-кнопка.
- Admin: auth реальный, dataProvider api, двухпанельные жалобы, баны, юзеры, **файл-менеджер «Файлы»** (папки по юзерам + галерея, #ID на тайлах, БЕЗ blur/эскалации, копир-#ID кнопка). Медиа при view-once/удалении у юзера НЕ удаляется из Storage/админки (удаление только клиентское).
- CI (.github/workflows/ci.yml), e2e+axe (web/e2e/).

## ЗАДАЧИ
ГОТОВО (задеплоено + проверено playwright на проде):
- **#38 ✅ КРИТ РЕШЁН:** «Медиа недоступно». КОРЕНЬ — null id при supabase-js `.insert()`: Prisma `@default(cuid())` генерит id в клиенте Prisma, а `db push` НЕ создаёт БД-дефолт для cuid → `null value in column "id"` (400) → профиль/медиа не создавались → synced=false навсегда. Фикс: `id: crypto.randomUUID()` во ВСЕХ 10 вставках (web: User/Profile/Conversation/Message/MediaAsset/Report; admin: Ban/ModeratorAction×3). Проверено 3× медиа-тестом (web/e2e/media-upload.spec.ts). Плюс defense-in-depth: ensureProfile до аплоада, ретрай аплоада 3×, серверный ретрай профиля.
- **#35 ✅:** one-view (одноразовое) — разблокировано фиксом #38, код готов.
- **#39 ✅:** автоскролл — scrollRef контейнера в низ через двойной rAF (msgs/typing/recording).
- **#40 ✅:** admin общая галерея `/gallery` (все медиа + #ID, фильтр, API ?all=1).
- **#41 ✅:** admin мобильная навигация (бургер + drawer).
- **#42 ✅:** admin PWA (manifest/sw.js/install; proxy matcher пропускает PWA-файлы).
- **#43 ✅:** playwright мобильный тест админки (web/e2e/admin-mobile.spec.ts, iPhone13 webkit, 7 разделов overflow=0).
- **#44 ✅:** admin респонсив (bulk-bar, badge, bans/audit, users-таблица).

- **#36 ✅:** Admin online по полу. web `/api/presence` heartbeat (online+lastSeen+realGender), пинг 30с в app-providers (realGender из useMatchPrefs). admin `/api/admin/overview` (online=lastSeen<90с) + страница `/online` (табы ж/м, live). Overview-карточки кликабельны. Проверено (web/e2e/admin-live.spec.ts).
- **#37 ✅:** Admin история + живые чаты. `/api/admin/chats` (диалоги + live-флаг lastMessageAt<5мин; ?id → сообщения+signed URL) + `/chats` (двухпанель, live-автообновление, мобильный back). Проверено.

ВСЁ ГОТОВО (#34–#44). Осталось только действие ЮЗЕРА: отозвать Vercel-токен + ротировать SUPABASE_SECRET_KEY/DB-пароль (светились в чате).

## Известные хрупкости
- Профиль не синкается при быстрой навигации/сети → медиа/persist падают. `ensureProfile()` добавлен (чат-маунт), но #38 всё ещё воспроизводится в тесте.
- Profile.online не сбрасывается на дисконнект → online-счётчики будут завышены без heartbeat.
- self-gender НЕ сохраняется в Profile → admin не знает пол для фильтров (#36).
- Скриншот на вебе заблокировать нельзя (только нативный app). Юзер просил — отклонено (веб-ограничение). Деттеррент «закрыть при потере фокуса» — юзер отменил.

## Тестовый харнесс
Playwright в `web/` (не в admin — там нет). Паттерн 2-девайс: onboard(ждать `synced===true`!) → /chat/<peer> → fake media args для голоса, canvas-webm для видео. НЕ использовать `addInitScript(localStorage.clear())` (стирает сессию на навигации). НЕ `locator.evaluate` в poll (авто-ждёт 30с) — использовать count()/isVisible().

## Опасность (усвоено)
- `rm web/*.mjs` УДАЛИЛ eslint.config.mjs+postcss.config.mjs и удаление закоммитилось. Восстановлено. НЕ чистить артефакты wildcard-ом — только по именам.

---

## Сессия 2026-07-01/02 (всё задеплоено на прод, tsc+lint=0)

Модерация:
- **Роль moderator vs super_admin**: сервер-403 (`PermissionError` в `admin/src/lib/admin-repo.ts` → route 403); перманент-бан+разбан только super_admin; клиент-гейт `usePermissions<string>({})`.
- **Mute**: `Profile.mutedUntil/muteReason` (миграция `packages/db/prisma/migrations/20260701120000_add_profile_mute`, применена `prisma migrate deploy`). Enforce в web `/api/messages` (403 muted) + `/api/presence` отдаёт muted; композер-нотис; admin `MuteDialog`.
- **Push-рассылка** всем/по полу: web `POST /api/push/broadcast` (секрет `ADMIN_BROADCAST_SECRET`), admin `POST /api/admin/broadcast` (super_admin) прокси + страница `/broadcast`. Env: web+admin `ADMIN_BROADCAST_SECRET`, admin `WEB_URL` (в Vercel prod, Sensitive → env pull не отдаёт).
- **Обзор**: карта «Всего»→/users, онлайн по полу инлайн крупно, убран нижний блок.
- **Файлы/Галерея**: серверная пагинация + фильтр дат (from/to) + меньше карточки (grid до 6 кол), общий `Pager`.

Чат/медиа (web):
- **БАГ сообщения не приходили** — broadcast эфемерный + история тянулась только при пустом local. Фикс: единый клиентский UUID (`crypto.randomUUID()`; POST /messages принимает `id`, upsert идемпотентно) + `connect()` ВСЕГДА мержит историю (`mergeHistory` в store/chat.ts: точное по id + fuzzy для легаси).
- **БАГ сессия не заканчивалась** — `POST /api/messages/end`→`Conversation.endedAt`; GET отдаёт `ended`; завершённый диалог по ссылке → редирект на «/» (`endedAtLoad`, router.replace).
- **Медиа Telegram-стиль**: мгновенная размытая превью (thumb ~32px в broadcast; фото canvas, видео кадр-постер). Фото сжимается перед аплоадом (≤1600px JPEG q0.82). Видео БЕЗ лимита/сжатия (юзер решил).
- **БАГ видео виснет «загрузка»** — `await makeVideoThumbnail` блокировал аплоад. Фикс: thumbnail параллельно (fire-and-forget) + жёсткие таймауты (3с/1.5с) в `makeVideoThumbnail`.
- **Лайтбокс**: стрелки убраны, свайп + счётчик 1/N.
- **Голос**: вибрация (start/stop/cancel, `navigator.vibrate` — iOS не поддерживает), анимация записи (пульс+эквалайзер).
- **Подбор**: пол = Мужчина/Женщина (без «Некто» и без поля «Пол собеседника»); авто-подбор противоположного пола (`setGender` ставит wantGender). Возраст = бэнды-кнопки (свой один, собеседник неск.). persist match-prefs v4.

PWA:
- **Авто-refresh**: `/api/version` (`NEXT_PUBLIC_BUILD_ID` из next.config = git-sha||Date.now, т.к. CLI-деплой git-sha пуст). app-providers поллит 60с/на фокус → reload ОТЛОЖЕН до возврата на вкладку (не рвёт чат).
- **Offline**: брендовая `/offline` + SW fallback. `sw.js` CACHE `anoon-v4`.
- **Уведомления**: `icon-512.png` + монохромный `badge-96.png` (белая «a», прозрачный фон — иначе белый квадрат на Samsung; генерён sharp через pnpm-store). notificationclick нормализует url → без 404.
- **Safe-area**: хедеры (главная/чат/настройки) + отступы под статус-бар/notch; глобально `overflow-x:hidden`.
- **Push subscribe (КРИТ)**: роут писал строку БЕЗ `id` → null-id (баг #38) → NOT NULL → подписка молча не сохранялась. Фикс: insert с `crypto.randomUUID()` (update по endpoint). После фикса нужно ПЕРЕвключить 🔔 на устройстве. Плюс: `serviceWorker.ready` перед subscribe (Android гонка сбрасывала тумблер), ретрай supabase-токена, баннер `PushPrompt`.

Push — почему не приходит (диагностика):
- iOS (`web.push.apple.com`) — ТОЛЬКО в установленной PWA (Add to Home Screen), iOS 16.4+. В Safari-вкладке НЕ придёт.
- Android (`fcm.googleapis.com`) — работает; проверить фильтр по полу рассылки.
- Фейк-подписки (`example.com/...`) от тестов портят счётчик — можно чистить.

НЕ делать (по решению юзера): рулетка «чистый чат при каждом матче» — историю НЕ стирать (у юзера другая идея, ждём). Была начата (matchId per-match в realtime.ts) и ОТКАЧЕНА.

---

## Сессия 2026-07-02 — УТВЕРЖДЁН план: реальные аккаунты + раскрытие=дружба + личка

Большая фича спроектирована и прошла 3 gstack-ревью (инженерное/дизайн 10/10/CEO). **Реализация НЕ начата.**

- **План-файл (источник правды):** `C:\Users\Admin\.claude\plans\synchronous-jumping-diffie.md`. Продолжать с раздела **G, шаг 1** (2 аддитивные миграции БД).
- **Что делаем:** обязательная регистрация (Google OAuth + email/пароль + восстановление; Apple отложен за флагом; email с подтверждением). Профиль: имя/фамилия/фото(опц.)/возраст-бэнд/пол (блокируется). Гостей нет; старые анонимы → рега с сохранением #ID (Supabase `linkIdentity`).
- **Раскрытие = дружба (один handshake):** чат рулетки анонимный (#ID) → «Раскрыть профиль» → приём → оба видят полный профиль + личка + список друзей. Модель `Friendship(pending|accepted)`, канонич. пара `(loId,hiId)`+`requestedById`, decline удаляет строку.
- **Рулетка теперь эфемерна** (новая Conversation на матч; отменяет прежнее «не стирать»). Уникальна по паре только личка друзей. Поиск только по #ID+ник (не по имени — деанон).
- **+3 расширения (CEO):** онлайн-статус друзей, ссылка/QR приглашения (`/add/[publicId]`), реакции в личке. Пуш «друг в сети» — отложен.
- **Находки ревью (учтены):** broadcast=хинт+сервер-гейт ре-фетч личности; enum ADD VALUE отдельной миграцией; `supabaseUserId` nullable→backfill→unique; DB-дефолт `gen_random_uuid()` новым таблицам; provider-agnostic gender-gate; `nextPublicId` гонка→SEQUENCE.
- **КОНСТАНТА:** anoon — только русский, без i18n.

---

## Сессия 2026-07-02 (вечер) — фича аккаунтов РЕАЛИЗОВАНА и НА ПРОДЕ

Реализована командой Agent Teams (15 задач T1–T10 + INT). tsc+eslint+прод-build зелёные, QA публичных страниц чист. Смёржено в main (merge `be2af5a`, feat `914cc06`).

**ЗАДЕПЛОЕНО НА ПРОД** (`vercel deploy --prod`, alias anoon-web.vercel.app) с `NEXT_PUBLIC_ACCOUNTS_ENABLED=true` в Vercel Production. Анонимный вход ЗАМЕНЁН обязательной регистрацией.

**БД:** 4 аддитивные миграции применены (accounts enum-split, accounts, public_id_fn RPC, message_reactions). БД очищена начисто перед запуском (TRUNCATE юзер-таблиц + Supabase Auth users + Storage bucket media; админы сохранены; SEQUENCE profile_public_seq → 00001).

**Что построено:**
- Реальные аккаунты: Google OAuth + email/пароль + сброс пароля. Провайдер-агностичный резолв (`getAuthUser`/`profileIdByUid` по `User.supabaseUserId`). PKCE в supabase.ts. Gender-lock (409 при смене).
- Раскрытие=дружба (единый `Friendship` pending|accepted). Серверный приватность-гейт `/api/profile/[publicId]` (перебор #ID → только publicId+ник). Защита от подделки friend_accept (личность только из server re-fetch).
- Личка друзей (`/dm/[id]`, kind=friend, отдельный `anoon:dm:` канал) + `/friends` + поиск по #ID/ник. Онлайн-статус друзей (по свежести lastSeen). QR-приглашения `/add/[publicId]`. Реакции в личке (Message.reactions).
- Эфемерная рулетка per-match: новая Conversation на матч (деанон закрыт), обе стороны сходятся на одном conversationId (инициатор генерит, шлёт в match-broadcast payload.c). Обратно совместимо (без convId → старое поведение).

**Supabase-конфиг (сделано юзером):** Google provider (client anoon-501211), Redirect URLs `https://anoon-web.vercel.app/**`, Site URL прод. Email-провайдер/Confirm — проверить.

**Осталось/проверить:** end-to-end тест auth/друзей/лички на живом проде с реальным Google/email; провайдер-строка из `app_metadata.provider` на реальном Google-токене (фолбэк→email не падает); email-подтверждение. Ротация секретов (Vercel-токен CLI-авторизация, SUPABASE_SECRET_KEY, Google client_secret `GOCSPX-...` — светился при настройке).

Детали плана: `C:\Users\Admin\.claude\plans\synchronous-jumping-diffie.md`.

