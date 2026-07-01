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

ОСТАЛОСЬ:
- **#36:** Admin overview — кликабельные карточки + онлайн-счётчики девочки/мальчики + список онлайн по полу. Требует: self-gender в Profile.realGender (сейчас пол только клиентский, realGender=any) + реальный online (Profile.online не сбрасывается; нужен heartbeat/lastSeen).
- **#37:** Admin история чатов + **живые идущие чаты** (Conversation/Message из БД, near-live). Теперь Message пишется (профили синкаются).

## Известные хрупкости
- Профиль не синкается при быстрой навигации/сети → медиа/persist падают. `ensureProfile()` добавлен (чат-маунт), но #38 всё ещё воспроизводится в тесте.
- Profile.online не сбрасывается на дисконнект → online-счётчики будут завышены без heartbeat.
- self-gender НЕ сохраняется в Profile → admin не знает пол для фильтров (#36).
- Скриншот на вебе заблокировать нельзя (только нативный app). Юзер просил — отклонено (веб-ограничение). Деттеррент «закрыть при потере фокуса» — юзер отменил.

## Тестовый харнесс
Playwright в `web/` (не в admin — там нет). Паттерн 2-девайс: onboard(ждать `synced===true`!) → /chat/<peer> → fake media args для голоса, canvas-webm для видео. НЕ использовать `addInitScript(localStorage.clear())` (стирает сессию на навигации). НЕ `locator.evaluate` в poll (авто-ждёт 30с) — использовать count()/isVisible().

## Опасность (усвоено)
- `rm web/*.mjs` УДАЛИЛ eslint.config.mjs+postcss.config.mjs и удаление закоммитилось. Восстановлено. НЕ чистить артефакты wildcard-ом — только по именам.
