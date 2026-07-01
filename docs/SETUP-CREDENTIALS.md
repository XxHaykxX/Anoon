# anoon — Мануал: какие креды нужны, откуда взять, куда положить

> Все секреты кладёшь **сам** в `.env`-файлы (они в `.gitignore`, в репо не попадут).
> В чат секреты слать НЕ обязательно — я читаю их из env. Мне достаточно сказать «готово».
> Только неприватное (имена проектов/бакетов, регион) можешь написать в чат.

**Правило безопасности:** приватные ключи (DB-пароль, R2 secret, VAPID private) — только в
`.env.local` / `.env` на диске. Никогда не в git, не в код, не в публичный чат/скрин.

---

## 1. Supabase / Postgres (Фаза B — фундамент данных) 🔴 самое нужное

**Зачем:** реальная БД для схемы `packages/db` (юзеры, жалобы, баны, медиа-мета).

**Откуда:**
1. https://supabase.com → Sign up (GitHub-логин ок).
2. **New project** → имя `anoon`, регион ближе к тебе (напр. Frankfurt), задай **Database Password** (сохрани!).
3. Подожди ~2 мин (создаётся БД).
4. Settings (шестерёнка) → **Database** → раздел **Connection string** → вкладка **URI**.
   - Возьми строку `postgresql://postgres.[ref]:[PASSWORD]@...pooler.supabase.com:6543/postgres`
     (это **pooled**, для приложения).
   - И **Direct connection** (порт 5432) — нужна для миграций Prisma.

**Куда положить** — создай файл `packages/db/.env`:
```
DATABASE_URL="postgresql://...pooler...:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...:5432/postgres"
```
**Мне скажи:** «supabase готов». (пароль/URL в чат не нужен)

---

## 2. Cloudflare R2 (Фаза E — медиа) 🟠

**Зачем:** хранение фото/видео/голосовых (сейчас локальные blob, не отправляются).

**Откуда:**
1. https://dash.cloudflare.com → Sign up.
2. Слева **R2** → (попросит включить, платёжка; есть бесплатный тир 10 ГБ).
3. **Create bucket** → имя `anoon-media`, регион Auto.
4. **Manage R2 API Tokens** (справа) → **Create API token** → права **Object Read & Write** →
   создать. Скопируй: **Access Key ID**, **Secret Access Key** (secret показывается 1 раз!).
5. На странице R2 сверху — твой **Account ID** (нужен для endpoint).
   - Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

**Куда положить** — в `.env` бэкенда (`backend/.env`, создам каталог на Фазе C):
```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=anoon-media
```
**Мне скажи:** «r2 готов» + можешь написать в чат имя бакета и account id (неприватно).

---

## 3. VAPID (Фаза G — push) 🟡

**Зачем:** Web Push подписка/рассылка.

**Откуда:** генерится локально, НЕ на сайте:
```bash
npx web-push generate-vapid-keys
```
Выдаст **Public Key** и **Private Key**.

**Куда положить:**
- Public → `web/.env.local`:
  ```
  NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public>
  ```
- Private → `backend/.env` (никогда в web!):
  ```
  VAPID_PRIVATE_KEY=<private>
  VAPID_SUBJECT=mailto:ты@почта
  ```
**Это могу сделать я сам** — скажи «сгенери vapid», запущу команду и разложу по env.
Для реальной доставки push на телефон нужен HTTPS-хостинг (Фаза H).

---

## 4. Vercel (Фаза H — деплой web + admin) 🟡

**Зачем:** прод-хостинг фронтов.

**Откуда:**
1. https://vercel.com → Sign up (GitHub-логин).
2. Нужен git-репозиторий на GitHub (см. §6). Import project → выбрать репо.
3. Два проекта из одного репо:
   - web: **Root Directory** = `web`, framework Next.js (авто).
   - admin: **Root Directory** = `admin`.
4. В каждом проекте → Settings → **Environment Variables** → добавить нужные
   (web: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; admin: ключи БД/данные).

**Мне скажи:** «vercel готов, репо на github <url>». Деплой сам не запущу без твоего ОК.

---

## 5. Хостинг бэкенда v2 (Фаза C/H) 🟠

**Зачем:** Bun+Hono+Socket.io — **персистентный процесс** (WebSocket), Vercel serverless не подходит.

**Варианты (выбери один):**
- **Railway** https://railway.app — просто, есть бесплатный старт. New Project → Deploy from repo → root `backend`.
- **Fly.io** https://fly.io — `fly launch`, хорошо для WS.
- **Render** https://render.com — Web Service, persistent.

**Что задать:** переменные из §1 (DATABASE_URL/DIRECT_URL), §2 (R2_*), §3 (VAPID_PRIVATE_KEY).

**Мне скажи:** какой хостинг выбрал — подгоню конфиг/Dockerfile. (можно позже, после Фаз B–D локально)

---

## 6. GitHub-репозиторий (нужен для Vercel/хостинга) ⚪

Сейчас репо локальный, без коммитов и без remote.
- Создать репо: https://github.com/new → приватный `anoon`.
- **Мне скажи «залей на github»** — я сделаю initial commit + подключу remote + push
  (только по твоей команде; `.env` не попадёт — в `.gitignore`).

---

## Что дать в первую очередь (порядок)
1. **Supabase** (§1) → разблокирует Фазы B, C, D, F — ядро.
2. **VAPID** (§3) — могу сгенерить сам хоть сейчас.
3. R2 (§2) — когда дойдём до медиа (Фаза E).
4. GitHub + Vercel + хостинг (§4–6) — на деплое (Фаза H).

**Минимум чтобы двинуть дальше:** дай Supabase (§1). Скажешь «supabase готов» — запущу Фазу B.
