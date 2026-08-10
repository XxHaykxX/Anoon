# anoon — production deploy runbook (Hetzner CX32)

One small VPS runs the whole stack behind a single domain with automatic HTTPS.
Architecture and cost rationale: `../DEPLOY-PLAN.md`. This file is the
*hands-on* runbook for the artifacts in this directory.

## The pieces

| File | Purpose |
|---|---|
| `compose.prod.yml` | Prod compose: caddy + frontend + admin + companion + tinode + postgres + coturn. Public ports: caddy 80/443, coturn 3478/5349/49160-49200. Per-service memory/CPU/pids ceilings. |
| `Caddyfile.prod` | Single-origin reverse proxy + automatic Let's Encrypt: `/api/*`→companion, `/v0/*`→tinode, else→frontend. Plus a separate `$ADMIN_DOMAIN` host behind basic-auth → admin. |
| `rotate-secrets.sh` | Secret generation (`generate`), rotation order + what to restart (`plan`), generator self-check (`selfcheck`). |
| `../admin/Dockerfile.prod` | Admin panel prod image (`next start`, non-root, `NEXT_PUBLIC_DATA_MODE=api` baked in). |
| `coturn/turnserver.conf` | TURN relay config (WebRTC calls behind NAT): auth, quotas, relay range, denied internal peer ranges. |
| `.env.prod.example` | Template for the server's `.env` — every var documented, placeholders only. |
| `deploy-hetzner.sh` | Bootstrap script for a fresh Ubuntu 24.04 VPS (docker, ufw, fail2ban, first `up -d --build`). |
| `initdb/10-create-anoon-db.sql` | Creates the companion's `anoon` DB on first postgres init (tinode's own init-db creates the `tinode` DB). |
| `companion/Dockerfile` | Already prod-grade (multi-stage → distroless, non-root) — reused as-is. |
| `../../frontend/Dockerfile.prod` | Frontend prod image with `NEXT_PUBLIC_*` build args (the generic `Dockerfile` can't bake them). |

Single-origin model: the browser only ever talks to `https://<DOMAIN>` — the
same pattern as the phone-test proxy (`Caddyfile.phone`), so the frontend runs
with `NEXT_PUBLIC_SAME_ORIGIN=1` and no backend hostnames are baked in.

## Prerequisites

1. **Domain** purchased; you can create DNS records for it.
2. **Hetzner** account; create a **CX32** (Nuremberg/Falkenstein — ~57 ms from
   Yerevan), **Ubuntu 24.04 LTS**, with your SSH key.
3. **DNS A record** `<DOMAIN>` → server IP (do it first; HTTPS then works
   immediately on first start).
4. Local workstation with `rsync` + ssh access to the server.

## Что уже подготовлено (2026-08-08)

Сделано заранее, повторять не нужно:

- **`server-stack/.env.prod` создан**, 34 из 42 переменных заполнены
  сгенерированными секретами (`rotate-secrets.sh generate`), включая пары,
  которые обязаны совпадать: `API_KEY_SALT` ↔ `NEXT_PUBLIC_TINODE_API_KEY`,
  `TURN_PASS` ↔ `NEXT_PUBLIC_TURN_PASS`, `ADMIN_SESSION_SECRET` ↔
  `COMPANION_ADMIN_TOKEN_SECRET` (attested-режим). Файл **не** в git —
  до этого он не подпадал ни под одно правило `.gitignore` (`*.env` требует
  окончания `.env`, а тут `.prod`), дыра закрыта.
- **Все четыре образа собраны и проверены**: `anoon-tinode:prod`,
  `anoon-companion:prod`, `anoon-frontend:prod`, `anoon-admin:prod`.
  Образ админки до этого **не собирался вовсе** — pnpm 10 валит установку, если
  build-скрипт зависимости пропущен (`ERR_PNPM_IGNORED_BUILDS`), а `sharp` и
  `unrs-resolver` в этом воркспейсе намеренно в `ignoredBuiltDependencies`.
  Деплой остановился бы на первом же шаге сборки.
- `docker compose -f compose.prod.yml --env-file .env.prod config` — валиден,
  семь сервисов.

**Осталось заполнить в `.env.prod` (только то, что даёт владелец):**
`WEB_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_BASIC_AUTH_HASH` (через
`caddy hash-password`), `ADMIN_BROADCAST_SECRET`, `COMPANION_GOOGLE_CLIENT_ID`,
`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`. Плюс `DOMAIN`, `ADMIN_DOMAIN`,
`ACME_EMAIL` — их проверить глазами, они зависят от купленного домена.

⚠️ Без живого проекта **Supabase** админка не поднимется: учётки операторов
живут там, и кодом это не закрывается. Текущий проект из `admin/.env` мёртв
(NXDOMAIN).

## First deploy

```bash
# 0. From the workstation — copy the three code trees to the server:
rsync -av --exclude node_modules --exclude .next --exclude .env \
    "server/"        root@SERVER_IP:/opt/anoon/server/
rsync -av --exclude .env \
    "server-stack/"  root@SERVER_IP:/opt/anoon/server-stack/
rsync -av --exclude node_modules --exclude .next --exclude ".env*" \
    "../frontend/" root@SERVER_IP:/opt/anoon/frontend/

# 1. On the server — bootstrap (installs docker, firewall, creates .env):
ssh root@SERVER_IP
bash /opt/anoon/server-stack/deploy-hetzner.sh
#    → first run stops after creating .env from the template.

# 2. Fill in real secrets (generation commands are inside the file):
nano /opt/anoon/server-stack/.env
#    Key rotation notes:
#    - API_KEY_SALT: new value + matching client api-key from Tinode's keygen
#      (go build ./keygen in ../server) → TINODE_API_KEY. Do this BEFORE launch.
#    - UID_ENCRYPTION_KEY: set once, NEVER change after users exist.

# 3. Re-run — builds images and starts everything:
bash /opt/anoon/server-stack/deploy-hetzner.sh
```

Then follow the checklist the script prints: verify
`https://<DOMAIN>/api/health`, register + promote the ROOT bot
(`init-db --make_root`), restart the companion.

**Prod safety already wired into `compose.prod.yml`:** `COMPANION_DEV_AUTH=0`
and `SAMPLE_DATA=""` are hard-coded (not env-overridable), `ENV=prod`,
CORS narrowed via `CORS_ALLOWED_ORIGINS` + `FS_CORS_ORIGINS`, no database or
gRPC port reachable from outside.

## Updating

```bash
# From the workstation: rsync the changed tree(s) again (step 0 above), then:
ssh root@SERVER_IP
cd /opt/anoon/server-stack
docker compose -f compose.prod.yml up -d --build   # rebuilds/restarts only what changed
```

- Tinode restarts in seconds; clients auto-reconnect.
- **Tinode version bump with schema change:** backup first, then one-off
  `UPGRADE_DB=true docker compose -f compose.prod.yml up -d tinode`, then set
  it back to `false` in `.env`.
- Companion schema migrations run automatically at startup.
- Changed `TINODE_API_KEY`/salt → the **frontend image must be rebuilt** (the
  key is baked in at build time): `docker compose -f compose.prod.yml build frontend`.

## Чеклист выката

Каждый шаг — с проверкой. Не переходи к следующему, пока проверка не прошла.
Все команды выполняются в `/opt/anoon/server-stack`.

**Перед выкатом**

1. `docker compose -f compose.prod.yml config >/dev/null` — compose валиден
   (проверка: команда молча вернула 0).
2. `pg_dump` обеих БД + том медиа — три команды из раздела «Backups» ниже.
   Проверка: файлы существуют и не нулевого размера
   (`ls -l /root/backup/*$(date +%F)*`).
3. Записать текущее состояние для отката:
   `docker compose -f compose.prod.yml images > /root/rollback-$(date +%F-%H%M).txt`
   и `git -C /opt/anoon rev-parse HEAD` (если код под git).
   Проверка: файл непустой, в нём image ID всех семи сервисов.
4. `cp .env .env.bak-$(date +%F-%H%M)` — снимок конфигурации.

**Выкат**

5. Синхронизировать код с рабочей станции (`rsync`, шаг 0 из «First deploy»).
   Проверка: `git status` / время файлов на сервере обновилось.
6. `docker compose -f compose.prod.yml build` — собрать образы ДО остановки
   чего-либо. Проверка: сборка завершилась без ошибок; старые контейнеры всё
   ещё работают и сайт открывается.
7. `docker compose -f compose.prod.yml up -d` — пересоздаются только
   изменившиеся сервисы. Проверка: `docker compose -f compose.prod.yml ps` —
   все `running`, у db и caddy `healthy`.

**Проверки после выката (все обязательны)**

8. `curl -fsS https://<DOMAIN>/api/health` → 200.
9. `curl -fsS -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/` → 200
   (фронт отдаётся).
10. `curl -fsS -o /dev/null -w '%{http_code}\n' https://<ADMIN_DOMAIN>/` → 401
    (basic-auth стоит), и с `-u admin:<пароль>` → 200.
11. `curl -fsS -o /dev/null -w '%{http_code}\n' https://<DOMAIN>/api/auth/rest`
    → 404 (внутренний хук наружу не торчит).
12. Логи на ошибки старта:
    `docker compose -f compose.prod.yml logs --since 5m companion tinode admin | grep -iE 'panic|fatal|refus'`
    — пусто.
13. Живой прогон в браузере: вход → рулетка → сообщение доходит → медиа
    открывается. Вход в админку и открытие списка жалоб.
14. Если менялась схема БД: `docker compose -f compose.prod.yml logs companion
    | grep -i migrat` — миграции применились без ошибок.

## Чеклист отката

Откат — это решение, которое принимают за минуту, а не за полчаса
диагностики. Критерий: любая из проверок 8–13 не прошла и не чинится одной
очевидной правкой `.env`.

**A. Откат кода/образов (данные не трогаем) — основной путь**

1. `docker compose -f compose.prod.yml down` — остановить стек.
   Проверка: `docker compose -f compose.prod.yml ps` пуст.
2. Вернуть предыдущее дерево кода: `rsync` прошлой версии с рабочей станции,
   либо `git -C /opt/anoon checkout <SHA из шага 3>`.
   Проверка: версия файлов совпадает с записанной.
3. Вернуть конфигурацию: `cp .env.bak-<метка> .env`.
   Проверка: `diff` показывает ожидаемые различия.
4. `docker compose -f compose.prod.yml up -d --build`.
   Проверка: заново пройти шаги 8–13.

Если образы уже публикуются в GHCR (планируемый шаг, DEPLOY-PLAN §7), откат
короче и надёжнее: подставить прошлый тег в `image:` и `up -d` без пересборки.
Теги не перезаписывать никогда.

**B. Откат БД — только если миграция испортила данные**

Автоматического отката схемы нет. Порядок:

1. `docker compose -f compose.prod.yml stop tinode companion admin frontend`
   — оставить только `db`. Проверка: `ps` показывает работающим только db
   (и caddy, если хочешь отдавать страницу-заглушку).
2. `docker exec -i anoon-prod-db psql -U postgres -c 'DROP DATABASE anoon;'`
   и `CREATE DATABASE anoon;` — затем
   `docker exec -i anoon-prod-db pg_restore -U postgres -d anoon < anoon-<дата>.dump`.
   Проверка: `psql -U postgres -d anoon -c '\dt'` показывает таблицы.
   То же для `tinode`, если испорчена и она.
3. Откатить код по пути A (иначе новая версия снова накатит ту же миграцию).
4. Поднять стек, пройти проверки 8–13.

**Чего откат НЕ вернёт**

- `UID_ENCRYPTION_KEY`: если его меняли — идентификаторы пользователей уже
  сломаны, восстановление только из дампа ВМЕСТЕ со старым ключом.
- Медиа: тома `anoon_uploads` дампы БД не покрывают, у них отдельный бэкап.
- Сертификаты: не удаляй том `caddy_data` при откате, иначе Let's Encrypt
  может упереться в rate limit при перевыпуске.

**Полный откат машины** — снапшот Hetzner (если включены Backups): восстанавливает
всё вместе с данными, но теряет всё, что произошло после снимка. Это последний
рубеж, а не первый.

## Backups (do before inviting users)

1. **Nightly cron on the host**: `pg_dump` of both DBs + the uploads volume,
   pushed off-machine (restic/rclone → Hetzner Object Storage):
   ```bash
   docker exec anoon-prod-db pg_dump -U postgres -Fc tinode > tinode-$(date +%F).dump
   docker exec anoon-prod-db pg_dump -U postgres -Fc anoon   > anoon-$(date +%F).dump
   docker run --rm -v anoon-prod_anoon_uploads:/u -v /root/backup:/b alpine \
     tar czf /b/uploads-$(date +%F).tgz -C /u .
   ```
2. **Hetzner Backups** (server snapshots, +20% of server price) — enable in
   the console for whole-machine restore.
3. **Test a restore** on a clean stand before launch — an untested backup is
   not a backup.

## DNS / HTTPS notes

- Caddy gets and renews Let's Encrypt certs automatically; requirement is just
  DNS pointing here and ports 80+443 open (the script's ufw rules do that).
- Certs + the ACME account live in the `caddy_data` volume — don't delete it,
  or reissuing may hit Let's Encrypt rate limits.
- If Cloudflare fronts the DNS, keep the record **DNS-only (grey cloud)** at
  least for launch — proxying WebSockets through CF adds failure modes.
- Watch issuance on first boot: `docker compose -f compose.prod.yml logs -f caddy`.

## TURN relay (coturn) — calls behind NAT

Most WebRTC calls connect peer-to-peer (STUN is enough), but ~10–20% of pairs
— symmetric NAT, strict mobile carriers, common on Armenian mobile networks —
can only talk through a relay. Without TURN those calls **never establish**.

- **Ports (published by coturn itself — TURN is not HTTP, cannot go through
  Caddy):** `3478` tcp+udp (STUN/TURN), `5349` tcp+udp (TURN over TLS/DTLS),
  `49160-49200/udp` relay range. The range is narrow on purpose (~40 concurrent
  relayed streams ≈ ~20 worst-case calls); to scale, widen it in **three**
  places together: `coturn/turnserver.conf` (min/max-port), `compose.prod.yml`
  (ports), `deploy-hetzner.sh` (ufw rule).
- **Auth:** one static user (`TURN_USER`/`TURN_PASS` in `.env`), long-term
  credential mechanism. The same values are baked into the frontend bundle
  (`NEXT_PUBLIC_TURN_*`) — i.e. **public by design**; abuse is bounded
  server-side (global quota, 3 Mbit/s per session, no relaying into private/
  metadata IP ranges). If leech traffic ever shows up: rotate the password
  (rebuild frontend) or upgrade to `use-auth-secret` + companion-minted
  ephemeral credentials.
- **TLS on 5349:** reuses the Let's Encrypt cert from Caddy's `caddy_data`
  volume (read-only mount). On the very first boot the cert doesn't exist yet —
  coturn logs a cert error but still serves plain TURN on 3478; run
  `docker compose -f compose.prod.yml restart coturn` once Caddy has issued.
  After each cert renewal (~60 days) coturn picks the new file up on its next
  restart; a monthly `restart coturn` cron is a cheap way to stay current.
- **Verify:** open <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>,
  add server `turn:<DOMAIN>:3478` with `TURN_USER`/`TURN_PASS`, press *Gather
  candidates* — a candidate of type **relay** must appear. Test `turns:<DOMAIN>:5349`
  the same way once TLS is up. No relay row = check ufw/ports/creds and
  `docker compose -f compose.prod.yml logs coturn` (look for `401` = wrong
  creds, or allocation errors = relay range/NAT problems).

## Админка: бутстрап и attested-режим

Панель ходит в companion не как «доверенный клиент с общим секретом», а с
подписанным токеном оператора. Это работает, только если два ключа совпадают
байт в байт:

```
ADMIN_SESSION_SECRET          (сервис admin — подписывает сессию оператора)
COMPANION_ADMIN_TOKEN_SECRET  (companion — проверяет X-Admin-Token)
```

`./rotate-secrets.sh generate ADMIN_SESSION_SECRET` выдаёт обе строки сразу —
именно поэтому парой. Если ключ пуст, companion откатывается в legacy-режим,
где роль оператора приходит обычным заголовком `X-Admin-Role`: любой, у кого
есть `COMPANION_ADMIN_SECRET`, объявляет себя `super_admin`, а авторство в
журнале модерации становится справочным. На стенде так и было. В проде — нет.

Шаги (один раз, после первого `up -d`):

1. Создать проект Supabase (учётки операторов живут там), взять URL и
   secret-ключ → в `.env`.
2. Завести первого оператора — пароль хешируется argon2id, в открытом виде
   нигде не сохраняется:
   ```bash
   docker compose -f compose.prod.yml exec -e ADMIN_EMAIL='you@example.com' \
     -e ADMIN_PASSWORD='<надёжный пароль>' -e ADMIN_ROLE=super_admin \
     admin node scripts/create-admin.mjs
   ```
   Проверка: скрипт напечатал созданного оператора; `history -d` или
   `unset HISTFILE`, чтобы пароль не остался в истории shell.
3. Задать basic-auth Caddy (второй замок):
   ```bash
   docker run --rm caddy:2-alpine caddy hash-password --plaintext '<пароль>'
   ```
   → `ADMIN_BASIC_AUTH_HASH` в `.env`, затем
   `docker compose -f compose.prod.yml up -d caddy`.
   Проверка: `https://<ADMIN_DOMAIN>/` без креды → 401, с кредами → форма входа.
4. Войти в панель, убедиться, что список жалоб грузится (значит, companion
   принял токен оператора, а не отверг с 401).

## Not covered here (known gaps)

- **Companion healthcheck** — образ distroless, внутри нет shell/curl, поэтому
  `healthcheck:` в compose задать нечем. Живость закрыта внешним монитором на
  `https://<DOMAIN>/api/health` (см. DEPLOY-PLAN §7). Понадобится настоящий
  healthcheck — добавить в companion флаг self-probe и вызывать сам бинарник.
- **GHCR image publishing / CI** — currently images build on the server itself.
- **S3 media storage** — start on the `fs` handler + volume; switch
  `MEDIA_HANDLER=s3` when the disk passes ~50% (see DEPLOY-PLAN §4).
