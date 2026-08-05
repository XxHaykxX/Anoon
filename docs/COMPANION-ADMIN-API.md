# Companion Admin API — спека для Фазы D (модерация)

> Написано 2026-07-03 по итогам A2 (аудит + адаптация `admin` под anoon). Это backend-бэклог
> для companion (`server-stack/companion`, Go): список REST-эндпоинтов, которые companion должен
> добавить, чтобы админка перестала быть mock-only и начала говорить с реальными данными anoon.
>
> Источник каждого эндпоинта — конкретный файл в `admin/src`, который его будет вызывать.
> Формы ответов подобраны так, чтобы **не менять** `admin-repo.ts`/route-handlers/UI сверх необходимого
> замены `supabaseAdmin()` на HTTP-вызов — см. план проводки в `server-stack/ADMIN-REUSE-PLAN.md` §5.
>
> Статус на момент написания: companion (`internal/api/router.go`) не отдаёт НИЧЕГО из этого списка.
> Единственный намёк на модерацию — `POST /reports` (`stub("reports.create")`, всегда 501).

---

## 0. Общие соглашения

- **Base URL (dev):** `http://localhost:6062` (companion REST, отдельно от Tinode `:6061`/`:16061`).
- **Кто вызывает:** только сервер админки (Next.js route handlers, `src/app/api/admin/**`), никогда
  браузер напрямую — админка сама уже прошла свою auth (httpOnly JWT cookie, см. `admin-session.ts`).
  Companion не обязан понимать роли admin — ролевые проверки (`super_admin` vs `moderator`) уже
  делает Next.js слой (`admin-repo.ts` бросает `PermissionError` ДО похода в companion). Companion
  обязан только: (а) доверять вызовы по служебному секрету, (б) писать `adminId`/`role` в свой
  журнал (`ModeratorAction`), которые ему передаёт вызывающая сторона.
- **Auth между admin-сервером и companion:** shared-secret заголовок, например
  `X-Companion-Admin-Secret: <ADMIN_SERVICE_SECRET>` (аналог текущего `ADMIN_BROADCAST_SECRET` в
  `broadcast/route.ts`). На каждый мутирующий запрос (`PATCH`/`POST`) admin также передаёт:
  `X-Admin-Id: <AdminUser.id>` и `X-Admin-Role: super_admin|moderator` — companion пишет их в
  `ModeratorAction`, но НЕ обязан сам проверять права (Next.js уже отверг недостаточные — см. выше).
  Это соответствует существующему разделению: `admin-session.ts`/`totp.ts`/`login-rate-limit.ts` и
  таблица `AdminUser` остаются вне companion (см. §7 ниже) — companion лишь исполнитель.
- **Формат списков:** `{ "data": T[], "total": number }` — 1-в-1 то, что уже возвращает
  `listResource()` в `admin-repo.ts`, чтобы `api/admin/[resource]/route.ts` не менялся вообще.
- **Пагинация:** query `page` (1-based), `pageSize`; `sort` (имя поля), `order` (`asc`|`desc`).
  Фильтры — `f_<field>=<value>` (равенство), как уже шлёт `api-data-provider.ts`.
- **Диапазон дат** (Файлы/Галерея): `from`/`to` как `YYYY-MM-DD`; `to` — **включительно** (до конца
  дня), ровно как сейчас реализовано в `media/route.ts` `dateRange()` (`< to+1day`). Companion должен
  повторить эту же семантику, чтобы UI не менялся.
- **Ошибки:** `{ "error": string }` + соответствующий HTTP-код (400 данные, 401 не авторизован,
  403 не хватает прав/действие не разрешено для роли, 404 не найдено).

---

## 1. `admin-repo.ts` → `listReports/listProfiles/listBans/listMedia/updateReport/updateResource`

Это ядро — обслуживает разделы **Жалобы, Пользователи, Баны** + generic `media`-ресурс Refine.

### GET /admin/reports
Query: `page,pageSize,sort,order,f_status,ids` (ids — csv для `getOne`/`getMany`).
Response `data[]` (`ReportRow`):
```json
{ "id": "...", "reporterId": "...", "targetProfileId": "...",
  "targetNickname": "...", "targetPublicId": "00003",
  "reason": "spam|abuse|sexual|illegal|other", "note": "...",
  "status": "open|in_review|resolved_banned|resolved_dismissed",
  "createdAt": "2026-07-03T10:00:00Z" }
```
Companion needs: собственная таблица `Report` (её сейчас нет — миграции `0001_init/0002_oauth/0003_roulette`
не содержат Report/Ban/ModeratorAction). Join на пользователя для nickname/publicId — companion уже
держит #ID↔UID маппинг (`internal/store/users.go`), нужно лишь денормализовать nickname/publicId в
ответе (одним запросом, не как сейчас в Supabase-версии — 2-4 последовательных запроса).

### PATCH /admin/reports/:id
Body: `{ "status": "resolved_banned"|"resolved_dismissed" }` + headers `X-Admin-Id`/`X-Admin-Role`.
Поведение (как в `admin-repo.ts updateReport`):
- Всегда: `Report.status = status`, `resolvedById = X-Admin-Id`, `resolvedAt = now`.
- Если `resolved_banned`: создать `Ban(profileId=target, reason="По жалобе", state="active",
  issuedById=adminId)` **и физически исполнить бан** — по `COMPANION-PLAN.md` §7 это ROOT
  `{acc state:"susp"}` на Tinode UID (вышибает сессии, блокирует вход). Плюс запись в
  `ModeratorAction(type="ban", targetProfileId, targetReportId)`.
- Если `resolved_dismissed`: `ModeratorAction(type="dismiss_report", targetReportId)`.
Response: обновлённый `ReportRow` (та же форма, что GET).

### GET /admin/users (он же `profiles`)
Query: та же пагинация + `ids`.
Response `data[]` (`ProfileRow`):
```json
{ "id": "...", "publicId": "00001", "nickname": "...", "emoji": "🦔",
  "online": true, "reportCount": 3, "banned": false, "createdAt": "..." }
```
`online`/`reportCount`/`banned` — денормализованные поля, вычисляемые companion на лету
(online из presence-трекера, reportCount — count по `Report.targetProfileId`, banned — есть ли
активный `Ban`). В Supabase-версии это делалось тремя отдельными запросами в JS — companion может
отдать одним SQL-джойном.

### PATCH /admin/users/:id — бан/разбан
Body варианты (companion должен поддержать оба, как сейчас `updateResource`):
- Бан: `{ "banned": true, "expiresAt": "2026-07-10T00:00:00Z" | null, "reason": "..." }`.
  Если `expiresAt == null` (перманентный) — **это уже отфильтровано на Next.js-стороне**
  (`PermissionError` до вызова companion, если role !== super_admin), но companion всё равно должен
  сам не позволять создать второй активный `Ban` на того же юзера (idempotent).
  Побочный эффект: ROOT `{acc state:"susp"}` на Tinode UID. Временный бан — companion сам
  снимает его по таймеру (`state:"ok"`) когда `expiresAt` наступает (нужен cron/scheduler внутри
  companion — Tinode сам не разбанивает).
  Пишет `ModeratorAction(type="ban", targetProfileId)`.
- Разбан: `{ "banned": false }` → `Ban.state="lifted"`, `liftedById`, `liftedAt`, ROOT
  `{acc state:"ok"}`, `ModeratorAction(type="unban", targetProfileId)`.
- Мьют: `{ "muted": true, "mutedUntil": "...", "muteReason": "..." }` — per `COMPANION-PLAN.md` §7,
  реализация — **снятие права `W`** через ROOT в acs топика/подписки (не FireHose, чтобы не быть на
  хотпасе). `ModeratorAction(type="mute", targetProfileId)`.
- Размьют: `{ "muted": false }` → возврат права `W`, `ModeratorAction(type="mute", reason="unmute")`.
Response: обновлённый `ProfileRow`.

### GET /admin/bans
Query: пагинация + `ids`.
Response `data[]` (`BanRow`):
```json
{ "id": "...", "profileId": "...", "nickname": "...", "publicId": "00004",
  "reason": "...", "expiresAt": "..."|null, "state": "active|expired|lifted", "createdAt": "..." }
```
`state="expired"` — companion должен сам переводить `active`→`expired` при достижении `expiresAt`
(тот же таймер/cron, что и авто-разбан выше — по сути один и тот же механизм).

### PATCH /admin/bans/:id
Body: `{ "state": "lifted" }` (единственная разрешённая мутация из раздела «Баны» — как в
`admin-repo.ts`, дублирует логику разбана из `PATCH /admin/users/:id`). Response: `BanRow`.

### GET /admin/media (generic, Refine-ресурс — НЕ путать с §4 ниже)
Тот же список, что и `GET /admin/media?all=1` в §4 — используется Refine'ом для универсального
CRUD-контракта (`useList`/`useOne` на resource `"media"`). Companion может отдавать её тем же
хендлером, что и файловый менеджер (§4), просто без папок.

---

## 2. `overview/route.ts` → сводка + онлайн

Обслуживает разделы **Обзор** и **Онлайн**.

### GET /admin/overview
Response:
```json
{ "total": 1240, "online": 87, "onlineFemale": 52, "onlineMale": 33, "onlineOther": 2,
  "reportsOpen": 6, "bansActive": 14 }
```
`total` — count всех Profile. `online*` — count по presence-трекеру (см. ниже) за окно 90с
(`ONLINE_WINDOW_MS` в текущем коде), разбитый по `realGender`. `reportsOpen`/`bansActive` — те же
агрегаты, что и в §1.

### GET /admin/online?gender=female|male|any
Response:
```json
{ "profiles": [
  { "id": "...", "publicId": "00001", "nickname": "...", "emoji": "🦔",
    "realGender": "female", "lastSeen": "2026-07-03T17:55:00Z", "reportCount": 3 }
] }
```
**Tricky-поля, которых пока нет:**
- `realGender` — реальный зарегистрированный пол (НЕ путать с эмодзи-персоной анон-чата). Должен
  жить в companion `User`/`Profile` таблице как отдельное поле, задаётся один раз при регистрации
  (per `COMPANION-PLAN.md` §3 — «пол... необратим»). Сейчас неясно, есть ли уже такое поле в
  `internal/store/users.go` / миграциях — если нет, это отдельный пункт бэклога до того, как раздел
  «Онлайн» станет реальным.
- `lastSeen` — согласно `COMPANION-PLAN.md` §0 (в самом конце), presence в анон-топиках **выключен**
  на уровне Tinode (топик без бита `P`), и именно поэтому *«онлайн-точку... даёт companion (он всё
  равно трекает online для админки)»* — то есть companion уже спроектирован держать свой
  presence-трекер независимо от Tinode `pres`. Этот трекер и должен быть источником `lastSeen`/
  `online` здесь. Если он ещё не реализован — это тоже отдельный подпункт (вероятно, простое
  `UPDATE Profile SET lastSeen=now() WHERE id=...` на каждый входящий REST/WS вызов от юзера,
  как heartbeat).

---

## 3. `chats/route.ts` → просмотр переписок (read-only)

Обслуживает раздел **Чаты**. Единственный раздел, где данные принципиально не в БД companion, а в
Tinode-топиках — companion читает их через свой ROOT gRPC-бот (`internal/tinode/client.go`).

### GET /admin/chats
Response:
```json
{ "conversations": [
  { "id": "topic123", "a": { "id":"p1","nickname":"...","publicId":"00001","emoji":"🦔" },
    "b": { "id":"p3","nickname":"...","publicId":"00003","emoji":"🦅" },
    "messages": 12, "lastMessageAt": "...", "createdAt": "...", "live": true }
] }
```
`live` = `now - lastMessageAt < 5min` (можно считать на стороне admin, как сейчас, если companion
просто отдаёт `lastMessageAt`; проще — companion считает сам, чтобы контракт был идентичен).

**Что нужно от companion:** ROOT `{get topic, what:"desc sub"}`/список топиков, где companion сам
является наблюдателем (ROOT подписан на все анон+friend топики per предположение из
`COMPANION-PLAN.md` §7 — *«переписки — ROOT-чтение топиков»*). Companion должен уметь перечислить
последние N активных топиков + для каждого — пару участников (переводя Tinode UID → #ID/nickname
через свой маппинг) и count сообщений. Это НОВАЯ функциональность в `internal/tinode/client.go` —
сейчас там наверняка есть только то, что нужно для auth/roulette/friends, не read-only chat listing.

### GET /admin/chats/:id/messages (сейчас `?id=`)
Response:
```json
{ "messages": [
  { "id":"m1","senderId":"p1","kind":"text","text":"...", "status":"read",
    "createdAt":"...", "mediaUrl": null, "mediaKind": null }
] }
```
Companion: ROOT `{get topic, what:"data"}` на конкретный топик → маппинг Tinode message envelope
(`from`, `content`, `head`) в это плоское представление. Для медиа-сообщений (`kind:"image"|"video"|
"audio"`) — резолвить вложение в `mediaUrl` (см. §4 — та же проблема подписанных URL). **Важно:**
это ROOT-чтение приватных переписок модератором — `COMPANION-PLAN.md` §7 явно помечает вопрос Q7a
как открытый («по всем чатам, или только по тем, где есть жалоба?») — юридически стоит решить ДО
реализации этого эндпоинта, а не после.

---

## 4. `media/route.ts` → файлы и галерея

Обслуживает разделы **Файлы** и **Галерея**.

### GET /admin/media/folders
Response:
```json
{ "folders": [
  { "profileId":"p3","nickname":"...","publicId":"00003","images":2,"videos":1,"count":3 }
] }
```
Группировка `MediaAsset` по владельцу — простой `GROUP BY ownerProfileId`, если у companion есть
таблица `MediaAsset` (см. ниже — её сейчас тоже нет).

### GET /admin/media?ownerId=&from=&to=&kind=&page=&pageSize=
### GET /admin/media?all=1&from=&to=&kind=&page=&pageSize= (общая галерея, есть `ownerBadge`)
Response (`files[]`):
```json
{ "id":"...", "ownerProfileId":"...", "ownerBadge":"#00003" ,
  "kind":"image|video", "url":"https://.../signed?...", "mime":"image/jpeg",
  "durationMs": 12000, "ephemeral": true, "expiresAt": "..."|null,
  "deletedAt": "..."|null, "escalated": false, "createdAt": "..." }
```
**Tricky-поля:**
- `r2Key` → `url` — companion должно решить, где физически лежат файлы (Tinode обычно пишет на
  локальный диск или свой S3-совместимый стор через `fileUploadHandler`, **не** Cloudflare R2 — R2
  упоминается в `admin/.env.example` как задел, но фактическое хранилище companion выберет само).
  В любом случае: этот эндпоинт обязан отдавать **не голый путь к файлу**, а временную
  подписанную/токенизированную ссылку (TTL ~1ч, как сейчас `createSignedUrl` в Supabase-версии) —
  спека FEATURES-ADMIN.md требует, чтобы медиа не открывалось без аудита/клика.
- `ephemeral`/`expiresAt`/`deletedAt` — это поля **view-once** (`COMPANION-PLAN.md` §8, «не начато»).
  Пока view-once не реализован в companion, эти поля можно временно всегда отдавать
  `ephemeral:false, expiresAt:null, deletedAt:null` — admin UI это переживёт (просто не покажет
  плашку «удалено»), но раздел не будет 1-в-1 соответствовать спеке, пока view-once не готов.
- `escalated` (было `retainedForReport` в Supabase-схеме) — флаг «медиа сохранено для расследования
  жалобы, не удалять по TTL». Companion должен выставлять его при `POST /reports` (сейчас 501-стаб):
  если жалоба ссылается на медиа — пометить это `MediaAsset.retainedForReport=true`, чтобы
  view-once/TTL-очистка его не тронула до разбора модератором. Это связывает §1 (жалобы) и этот
  раздел — реализовывать их стоит вместе.

---

## 5. `broadcast/route.ts` → массовая рассылка

### POST /admin/broadcast
Body: `{ "title": string, "body"?: string, "url"?: string, "gender": "all"|"male"|"female" }`.
Response: `{ "sent": number, "total": number }`.
Companion needs: собственное хранилище push-подписок (VAPID web-push), см. `COMPANION-PLAN.md` §10
(Фаза E1, явно отложена на «после подключения фронта» — сейчас в проекте это ⬜ не начато). Пока это
не готово, оставить mock-ответ в admin (см. `broadcast/route.ts` — уже сделано в рамках A2). Это
единственный раздел, где companion-эндпоинт логически **не блокирует** остальную миграцию — можно
включать последним.

---

## 6. `supabase-admin.ts` → `companion-client.ts`

Не эндпоинт, а инфраструктурная замена клиента:
- `COMPANION_URL` (env, напр. `http://localhost:6062` dev / внутренний DNS-адрес в проде).
- `COMPANION_ADMIN_SECRET` (env, shared-secret заголовок — см. §0).
- Обёртка `fetch` с таймаутом (~5с) + единая обработка `{error}`-тела на не-2xx — зеркалит текущий
  паттерн `json<T>()` в `api-data-provider.ts`, только на сервере (`admin-repo.ts` сам ходит через
  этот клиент, как раньше ходил через `supabaseAdmin()`).
- Health-check перед первым использованием: companion уже отдаёт `GET /health` — можно на старте
  Next.js сервера (или в `/api/admin/*` при первом запросе) пинговать его и явно логировать, если
  companion недоступен, вместо тихого падения на каждый список.

---

## 7. Что сознательно НЕ переезжает в companion

- **AdminUser** (email/argon2id/TOTP-секрет/роль) — операторские аккаунты самой админки, отдельная
  система от юзеров anoon. Может остаться в Supabase (как сейчас) или переехать в БД `anoon` companion
  как отдельная таблица без публичного REST — в обоих случаях companion НЕ обязан участвовать в
  логине админа. `admin-session.ts`/`totp.ts`/`login-rate-limit.ts` не меняются вообще.
- **Аудит-журнал в UI** (`lib/audit.ts`, раздел «Журнал») — по спеке это сессионный лог браузера
  («не вся история из БД»), он и дальше живёт только на клиенте; `ModeratorAction` в companion —
  отдельная, более полная запись для будущего постоянного журнала, не обязана прямо сейчас иметь
  свой GET-эндпоинт для UI.

---

## Порядок реализации (рекомендация)

1. **Схема данных companion**: таблицы `Report`, `Ban`, `ModeratorAction`, `MediaAsset` (миграция
   `0004_moderation.sql` или подобная — сейчас в companion есть только init/oauth/roulette).
2. **§1 (reports/users/bans)** — наибольший leverage, обслуживает 3 из 10 разделов + ban/unban/mute
   побочные эффекты на Tinode (ROOT `state`/acs).
3. **§2 (overview/online)** — короткий, зависит от presence-трекера, который companion и так должен
   был завести для анонимности (`COMPANION-PLAN.md` §0).
4. **§4 (media/files/gallery)** — зависит от решения по физическому стору файлов + view-once.
5. **§3 (chats)** — самый рискованный (юридический вопрос Q7a про доступ модератора к перепискам) и
   технически самый непохожий на остальные (чтение чужого Tinode-топика, а не своя таблица).
6. **§5 (broadcast)** — последний, зависит от push-инфраструктуры (Фаза E1), не блокирует остальное.
