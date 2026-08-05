# Админка anoon — аудит легаси anoon-admin, переименование, план переиспользования

> Обновлено 2026-07-03. Аудит `C:\Users\Admin\Desktop\anoon\admin`. Опирается на
> [FEATURES-ADMIN.md](../FEATURES-ADMIN.md) (спека), [BUILD-PLAN.md](../BUILD-PLAN.md) (D3),
> [PROJECT-STATUS.md](../PROJECT-STATUS.md).

---

## 1. Стек (что там на самом деле)

**Next.js 16.2.9 + React 19.2 + Refine v5 + Tailwind v4 + Framer Motion + TypeScript.**
Дополнительно: `@tanstack/react-virtual` (виртуализация таблиц), `yet-another-react-lightbox` +
`@vidstack/react` (медиа-вьювер/видео), `jose` (JWT-сессия admin, edge-safe), `@node-rs/argon2`
(хэш паролей), собственный TOTP (RFC 6238, без зависимостей), `@supabase/supabase-js`.

**Важное открытие: это НЕ моки-заглушка, а реально подключённый бэкенд.**
`admin/.env` содержит живые креды: реальный `SUPABASE_URL`/`SUPABASE_SECRET_KEY`, реальный
`ADMIN_SESSION_SECRET`, реальные `ADMIN_EMAIL`/`ADMIN_PASSWORD`. `NEXT_PUBLIC_DATA_MODE=api` —
т.е. кто-то уже поднял отдельный Supabase-проект (Postgres + Storage bucket `media`) со схемой
Profile/Report/Ban/ModeratorAction/MediaAsset/Conversation/Message и админка на него живьём ходит
через `src/lib/admin-repo.ts` (`@supabase/supabase-js`, secret-ключ, bypass RLS). Также есть
Vercel-деплой (`.vercel/`, project slug `anoon-admin`, environment=development).
Это отдельная (не наша) инфраструктура v2 — под наш companion (Go/gRPC на server-stack) она
изначально не рассчитана, но сам контракт данных почти 1:1 совпадает с тем, что нужно anoon.

Два режима данных переключаются одной env-переменной `NEXT_PUBLIC_DATA_MODE`:
- `mock` — `providers/mock-data-provider.ts` + `data/fixtures.ts` (in-memory, для UI-разработки без бэка).
- `api` — `providers/api-data-provider.ts` → `/api/admin/*` (Next Route Handlers) → `admin-repo.ts` → Supabase.

---

## 2. Покрытие спеки (FEATURES-ADMIN.md)

| Раздел спеки | Файл | Статус | Комментарий |
|---|---|---|---|
| Вход + роли (2FA, rate-limit, 8ч сессия) | `login/page.tsx`, `lib/totp.ts`, `lib/login-rate-limit.ts`, `lib/admin-session.ts` | ✅ | TOTP RFC6238 свой, rate-limit 5/5мин совпадает со спекой день-в-день, JWT httpOnly 8ч (`TTL_SECONDS=8*3600`). Роли `moderator`/`super_admin` в JWT payload. |
| Обзор (4 плитки, live 20с) | `(dashboard)/overview/page.tsx` + `api/admin/overview` | ✅ | Кликабельные карточки → верные разделы, разбивка 👧/👦, интервал 20с точно как в спеке. |
| Онлайн (live 15с, вкладки, 90с окно) | `(dashboard)/online/page.tsx` | ✅ | Вкладки Все/Девочки/Мальчики, "N сек/мин назад", копировать #ID — всё есть. |
| Чаты (read-only, 10с/5с, "идёт") | `(dashboard)/chats/page.tsx` + `api/admin/chats` | ✅ | Два-панельный layout, мигающий бейдж "идёт", подпись "только для чтения", мобильный back-паттерн — всё как в спеке. |
| Жалобы (очередь, hotkeys J/K/B/X, bulk) | `(dashboard)/reports/page.tsx` | ✅ | Хоткеи, типы жалоб с цветами, "!" + "Эскалация" на illegal, bulk-бан/отклонить с подтверждением. |
| Пользователи (сортировка по жалобам, карточка) | `(dashboard)/users/page.tsx`, `users/[id]/page.tsx` | ✅ | Виртуализация >50 строк, bulk-бан только super_admin, карточка с медиа-ревью и подписью про "Чаты". |
| Баны (вкладки Активные/Истёкшие/Снятые) | `(dashboard)/bans/page.tsx` | ✅ | Счётчики на вкладках, "Снять" только у активного + только super_admin. |
| Окно бана (чипы причин, срок, роль-гейт) | `components/ban-dialog.tsx` + `admin-repo.ts updateResource` | ✅ | Перманентный бан недоступен модератору на сервере (`PermissionError`), не только в UI. |
| Мьют (заглушка из спеки) | `components/mute-dialog.tsx`, подключён в `users/[id]/page.tsx` | ✅ | Причины/сроки 1ч-24ч-7д как в спеке, кнопка "Замьютить" на карточке пользователя подтверждена. |
| Файлы (папки по юзерам, даты, счётчики) | `(dashboard)/media/page.tsx` + `api/admin/media` | ✅ | Папки слева, дата-фильтр, копирование #ID, без блюра (`noBlur`) как в спеке. |
| Галерея (Все/Фото/Видео, даты) | `(dashboard)/gallery/page.tsx` | ✅ | Вкладки типов, дата-фильтр, пагинация, #ID на тайле. |
| Медиа-поведение (блюр, lightbox, эскалация) | `components/media-gallery.tsx` | ✅ | blur-by-default в жалобах/reports, lightbox+zoom, видео vidstack muted/no-autoplay, "удалено/истекло", кнопка "Эскалировать" блокирует просмотр. |
| Рассылка (только super_admin, поля, подтверждение) | `(dashboard)/broadcast/page.tsx` + `api/admin/broadcast` | ✅ | Ролевой гейт и на клиенте, и на сервере; лимиты 120/300 символов; "Отправлено: N из M". |
| Журнал (лента текущей сессии) | `(dashboard)/audit/page.tsx` + `lib/audit.ts` | ✅ | Именно "текущая сессия браузера", как и оговорено в спеке (не вся история из БД). |
| Тосты, копирование #ID, поиск-декор, PWA | `ui/toaster.tsx`, `components/pwa.tsx`, `admin-shell.tsx` | ✅ | Тосты ~3.5с, поиск в шапке декоративный (без onChange) — 1-в-1 спека. PWA manifest+SW есть. |

**Итог: спека закрыта на 100% на уровне UI/UX/бизнес-правил** — все 10 разделов, включая мьют,
2FA, ролевые гейты (и клиент, и сервер), хоткеи и точные интервалы live-обновления.

---

## 3. Переименование anoon → anoon

Выполнено механически, без изменения поведения (typecheck после — 0 ошибок):

**Код (src/, public/):**
- `public/manifest.webmanifest` — name/short_name/description.
- `public/sw.js` — комментарий + `CACHE = "anoon-admin-v1"`.
- `src/app/layout.tsx` — `<title>`, description, `appleWebApp.title`.
- `src/app/globals.css` — комментарий-заголовок бренд-токенов.
- `src/app/login/page.tsx` — заголовок "anoon · admin", дефолтный email `admin@anoon.app`.
- `src/components/admin-shell.tsx` — бренд-плашка сайдбара/drawer (×2), буква-логотип `a`→`b`.
- `src/lib/admin-session.ts` — имя cookie `anoon_admin` → `anoon_admin`.
- `src/providers/auth-provider.ts` — localStorage-ключ `anoon-admin-auth`→`anoon-admin-auth`, дефолтный email.
- `src/app/api/admin/broadcast/route.ts` — фолбэк `WEB_URL` на `anoon-web.vercel.app`.
- `src/data/fixtures.ts` — мок-сиды картинок `IMG("anoon-mN")` → `IMG("anoon-mN")` (×6, чисто мок-данные, picsum-заглушка).
- `.env.example` — заголовок-комментарий, `DATABASE_URL` шаблон, `ADMIN_EMAIL` шаблон.
- Документы: `README.md`, `PLAN.md`, `PROGRESS.md`, `questions.md`, `DESIGN.md`, `AGENTS.md` — упоминания бренда/проекта.

**Сознательно НЕ трогал (реальные секреты / внешняя инфра, не "безопасно для рефакторинга"):**
- `admin/.env` — реальный `ADMIN_EMAIL=admin@anoon.app` и реальный пароль/секреты живого
  Supabase-проекта. Если сменить email здесь без правки самой строки в таблице `AdminUser`
  (или её аналога) на Supabase-стороне — админ потеряет доступ. **Это отдельное действие**
  (в Supabase) вне рамок текстового rename.
- `admin/.env.local` — Vercel OIDC-токен, не относится к бренду.
- `admin/.vercel/` — Vercel project slug `anoon-admin` (переименование = отдельная операция в Vercel, не файловая).
- `package.json` (`"name": "adminapp"`) — уже нейтральное имя, anoon не упоминает.

**Проверка:** `npx tsc --noEmit` после rename → 0 ошибок. Полнотекстовый grep `anoon` (case-insensitive)
по всему `admin/` (кроме исключённых выше .env/.vercel) → 0 совпадений.

---

## 4. Reuse vs rewrite — рекомендация: **ПЕРЕИСПОЛЬЗОВАТЬ**

В отличие от истории с `frontend` (там пришлось переписывать messenger-фронт с нуля из-за
несовместимого старого стека), здесь ситуация другая:

- Стек уже актуальный (Next 16, React 19, Tailwind v4) — не легаси в техническом смысле,
  просто "старобрендированный".
- Дизайн-система (`DESIGN.md`) уже реализует то же ТЗ: тёмная тема, `#000`/`#FDBF2D` — **это и есть
  бренд-цвет anoon** (`#FDBF2D`), совпадение не случайное — админку и делали под этот бренд ещё
  до переименования anoon→anoon.
- Соответствие FEATURES-ADMIN.md — см. таблицу выше, практически 100% с точными деталями
  (интервалы live-обновления, хоткеи, ролевые гейты и на клиенте, и на сервере, тексты подписей —
  всё совпадает дословно с русским текстом спеки). Это значит либо спека писалась по факту этой
  админки, либо админка строилась по этой же спеке — в обоих случаях переиспользование дешевле
  переписывания.
- Архитектура чистая: Refine `DataProvider`/`AuthProvider` — тонкая абстракция, вся бизнес-логика
  (ролевые проверки, аудит, форматирование) — в `admin-repo.ts` и компонентах, не завязана на
  Supabase-специфику напрямую (кроме самого файла `admin-repo.ts` + `supabase-admin.ts`).

**Единственная несовместимость — бэкенд.** Админка сейчас говорит с Supabase Postgres/Storage
(отдельный, чужой проект), а наша архитектура (PROJECT-STATUS.md/BUILD-PLAN.md) — Tinode + свой
`companion` (Go, gRPC `:16061`, Postgres `anoon`). Это решается заменой **одного слоя** (см. §5),
без переписывания UI.

**Рекомендация:** взять админку как основу, портировать data-layer на companion. Рабочая оценка —
недели, не месяцы: UI/UX/бизнес-правила готовы, меняется только "проводка" к данным.

---

## 5. План проводки к companion-API

### Где сейчас швы (seams) — единственное, что меняется

```
UI-страницы (pages, dialogs, hooks)          ← НЕ трогаем, работают через Refine-контракт
        │  useList / useUpdate (Refine)
        ▼
providers/api-data-provider.ts               ← НЕ трогаем (обычный REST-фетч на /api/admin/*)
        │  fetch("/api/admin/<resource>")
        ▼
src/app/api/admin/**/route.ts                ← МЕНЯЕМ: вместо supabaseAdmin() дергаем companion
        │
        ▼
src/lib/admin-repo.ts + supabase-admin.ts    ← ЗАМЕНЯЕМ: Supabase-запросы → HTTP-клиент companion
        │
        ▼
companion (Go, наш сервис, БД anoon)          ← НОВОЕ: admin-scoped REST-эндпоинты
        │  gRPC (ROOT-бот)
        ▼
Tinode (:6061 / :16061)                      ← источник правды по чатам/presence/медиа
```

### Что нужно от companion (см. также BUILD-PLAN.md D3)
1. **Онлайн** — companion уже держит presence (свой online-статус профиля); нужен
   admin-эндпоинт `GET /admin/online?gender=` (аналог текущего `Profile.lastSeen>=now-90s`).
2. **Чаты (read-only)** — companion как ROOT-бот видит анон-топики через gRPC; нужен
   `GET /admin/chats` (список диалогов) и `GET /admin/chats/:id` (сообщения) — тонкая
   read-only обёртка поверх Tinode `get data`/`get sub`, без сохранения лишнего состояния.
3. **Жалобы/Баны/Мьюты** — это уже часть D1 (Фаза D в BUILD-PLAN.md): companion хранит Report/Ban
   в своей БД `anoon`, бан = Tinode state, мьют = снятие права `W` через ROOT-бота. Админка будет
   писать через `PATCH /admin/users/:id { banned, expiresAt }` вместо прямого Supabase update —
   контракт значений (banned/expiresAt/muted/mutedUntil/muteReason) можно оставить **тем же**,
   что сейчас в `admin-repo.ts`, чтобы не трогать UI/диалоги вообще.
4. **Рассылка** — companion уже будет держать push-подписки (Фаза E1, VAPID); заменить
   `WEB_URL`-прокси на `POST /admin/broadcast` в companion.
5. **Файлы/Галерея** — зависит от того, где companion/Tinode хранят медиа (Tinode обычно — на
   диске/S3 через `fileUploadHandler`, не R2 как в текущей Supabase-версии). Нужен эндпоинт вида
   `GET /admin/media?ownerId=&from=&to=` отдающий подписанные/временные URL так же, как сейчас
   `createSignedUrl` из Supabase Storage — контракт (`url`, `deletedAt`, `escalated`, `ephemeral`)
   можно сохранить один в один.

### Рекомендуемый порядок работ (после того как Фаза D companion будет готова)
1. Завести `lib/companion-admin-client.ts` (fetch-обёртка к companion admin-API, с сервисным
   токеном/mTLS — админка это Next.js SSR-слой, может ходить к companion напрямую, не через браузер).
2. В `admin-repo.ts` заменить тела функций (`listReports`, `listProfiles`, `listBans`, `listMedia`,
   `updateReport`, `updateResource`) на вызовы этого клиента — **сигнатуры и форма возврата не
   менять**, чтобы route handlers и UI не заметили разницы.
3. `api/admin/overview`, `api/admin/chats`, `api/admin/media`, `api/admin/broadcast` — то же самое:
   внутренности на companion, наружный контракт (JSON-форма ответа) не менять.
4. Убрать `@supabase/supabase-js` и `supabase-admin.ts` из зависимостей, когда миграция завершена.
5. Роли/2FA/сессия (`admin-session.ts`, `totp.ts`, `login-rate-limit.ts`) — **не трогать вообще**,
   они не зависят от бэкенда данных; единственное — где хранится сам `AdminUser` (сейчас в
   Supabase) нужно перенести в БД `anoon` companion (таблица AdminUser + argon2id, как и было
   спроектировано изначально в Prisma-схеме `packages/db/prisma/schema.prisma`).

### Риски / открытые вопросы
- Нужно решить, живёт ли AdminUser-таблица в БД `anoon` (той же, что companion) или остаётся
  отдельно — проще в той же, одна БД, один compose.
- Тонкие места производительности: текущий `admin-repo.ts` делает по 2-4 последовательных запроса
  на список (join вручную в JS) — при переходе на companion можно сразу отдавать уже
  denormalized JSON одним вызовом gRPC/REST, будет быстрее, чем было на Supabase.
- Медиа: если Tinode хранит файлы локально (не R2/S3), нужен свой сервис подписанных URL с TTL —
  иначе прямые ссылки на файлы Tinode не будут "protected" как того требует спека (медиа за жалобой
  — только по клику/аудируемо).

---

## 6. Итог для команды
- **Стек:** Next.js 16 + Refine v5 + Tailwind v4 + Framer Motion, TS. Уже актуальный, не легаси.
- **Покрытие спеки:** ~100% (все 10 разделов FEATURES-ADMIN.md реализованы с точным совпадением
  деталей — интервалы live-обновления, хоткеи, ролевые гейты и на клиенте, и на сервере).
- **Rename:** anoon→anoon выполнен по всему коду/докам (кроме `.env`/`.vercel` — живые
  секреты/инфраструктура, требуют отдельного ручного шага на стороне Supabase/Vercel).
  `tsc --noEmit` = 0 после rename.
- **Рекомендация: переиспользовать**, не переписывать. Единственная реальная работа — заменить
  data-layer (Supabase → companion REST/gRPC) в `admin-repo.ts` + route handlers; UI, роли, 2FA,
  аудит, ролевые гейты, PWA — готовы и не требуют переписывания.
- **Зависимость:** эта проводка возможна только после того, как companion (Фаза A2/A3 и D1 в
  BUILD-PLAN.md) реализует admin-scoped эндпоинты для online/chats/reports/bans/media/broadcast.
  До этого админку можно продолжать держать в `mock`-режиме для UI-доводок (например, MuteDialog).
