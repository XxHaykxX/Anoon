# Прод развёрнут — 2026-08-10

**Приложение:** https://5-129-206-152.sslip.io/anoon
**Админка:** https://admin.5-129-206-152.sslip.io (basic-auth, пароль в
`C:\Users\Admin\.anoon\anoon-admin-basic-password.txt` на рабочей машине)

## Где живёт

Timeweb Cloud, сервер `8641467` (`5.129.206.152`), Ubuntu 24.04, 2 CPU / 4 ГБ /
50 ГБ. **Сервер не пустой:** на нём уже работают два чужих боевых сайта
(`gtsmt.ru`, `maestrodenta.ru`) под nginx. Всё наше лежит отдельно в
`/opt/anoon` (git-клон), чужие конфиги не открывались.

Точка отката: снимок диска `before-anoon-2026-08-10` (4.6 ГБ, создан до любых
изменений).

## Почему домен не понадобился

Let's Encrypt не выдаёт сертификаты на IP, а без HTTPS у приложения отваливается
половина: service worker (PWA), web push и `getUserMedia` (звонки) требуют
secure context. Решение — `sslip.io`: `<что угодно>.<ip-через-дефисы>.sslip.io`
резолвится в этот IP, чего достаточно для ACME HTTP-01. Сертификат выпущен на
оба хоста разом (`--cert-name anoon`), продление — штатным таймером certbot.

## Как устроено на общем хосте

nginx остаётся на 80/443 и терминирует TLS; наш Caddy опубликован **только на
`127.0.0.1:8080`** и по-прежнему делает single-origin маршрутизацию
(`/api/*` → companion, `/v0/*` → tinode, остальное → frontend), от которой
зависят куки, WebSocket и CORS.

- `server-stack/compose.behind-proxy.yml` — оверлей: порт на loopback.
- `server-stack/nginx-anoon.conf` — отдельный vhost, ставится своим файлом.
- `Caddyfile.prod` параметризован: `APP_SITE`/`ADMIN_SITE` со схемой `http://`
  говорят Caddy не выпускать сертификат, которого он всё равно не получит.
- `/etc/nginx/conf.d/anoon-ws-map.conf` — `map $http_upgrade $connection_upgrade`
  (в nginx.conf его не было, а без него умирают все WebSocket).

## Проверено живьём

| Что | Результат |
|---|---|
| `https://…/anoon` | 200, сертификат валиден |
| `https://…/api/health` | 200, `{"db":true}` |
| Админ-хост | 401 (basic-auth держит) |
| Регистрация | 201, выдан `#00001` |
| Вход двух пользователей | оба попали в «Чаты» |
| Рулетка | матч, алиасы `~A94DVY` / `~RKG8DR` |
| Сообщение A → B | дошло |
| Ошибки консоли | 0 у обоих |
| Соседние сайты | `gtsmt.ru` 200, `maestrodenta.ru` 200 |
| TURN 3478 | открыт снаружи |

ROOT-бот `anoonbot` зарегистрирован и повышен (`init-db --make_root`,
конфиг — `/opt/tinode/working.config`, **не** `tinode.conf`, того файла нет).

## Что не работает и почему

- **Вход в админ-панель.** Учётки операторов живут в Supabase, проект из
  `admin/.env` мёртв (NXDOMAIN). Контейнер поднят, basic-auth работает, но
  дальше формы не пройти, пока нет живого проекта Supabase. Кодом не лечится.
- **Google-вход** — нет `COMPANION_GOOGLE_CLIENT_ID`.
- **Письма** (сброс пароля, верификация) — SMTP в коде заглушён, письма пишутся
  в лог. Регистрацию это не блокирует.
- **Оплаты** — провайдер не выбран, работает sandbox-seam.

## Эксплуатация

```bash
ssh -i ~/.ssh/gts_vps root@5.129.206.152
cd /opt/anoon/server-stack
docker compose -f compose.prod.yml -f compose.behind-proxy.yml ps
docker compose -f compose.prod.yml -f compose.behind-proxy.yml logs -f companion
git -C /opt/anoon pull && docker compose -f compose.prod.yml -f compose.behind-proxy.yml up -d --build
```

Секреты — `/opt/anoon/server-stack/.env` (0600, не в git). В нём
`ADMIN_BASIC_AUTH_HASH` хранится с удвоенными `$$`: compose интерполирует `$`, и
без экранирования bcrypt-хеш приезжал бы в контейнер порезанным.

## Бэкапы и восстановление

Крон: `30 3 * * * /opt/anoon/scripts/backup-db.sh` — `pg_dumpall` всего кластера
(обе БД плюс роли), gzip, ротация 14 последних, `/var/backups/anoon` под `0700`.
Скрипт сам бракует обрезанный дамп: проверяет `gunzip -t`, размер и хвост
`PostgreSQL database cluster dump complete`.

**Восстановление проверено 2026-08-10** — не «бэкап лежит», а дамп реально
разворачивается. Свежий дамп штатным скриптом залит во временный
`postgres:16-alpine`, прод не трогали:

```bash
docker run -d --name anoon-restore-test -e POSTGRES_PASSWORD=… postgres:16-alpine
zcat /var/backups/anoon/anoon-YYYYMMDD-HHMM.sql.gz | docker exec -i anoon-restore-test psql -U postgres
docker rm -f anoon-restore-test
```

Совпало: 19 таблиц в `anoon` и 13 в `tinode`, построчные счётчики один в один,
`schema_migrations` до `0016_billing.sql`. Единственное сообщение —
`ERROR: role "postgres" already exists`, оно ожидаемо: роль создаёт сам образ.

## Мониторинг

`*/5 * * * * /opt/anoon/scripts/healthcheck.sh` бьёт в `/api/health`. Лога на
самой машине мало: сервер, умерший целиком, ничего в свой лог не напишет.
Поэтому скрипт умеет **внешний dead-man's switch** — при OK пингует URL, при
отказе `URL/fail` с кодом и телом; тревогу поднимает молчание, и решает это
сторона снаружи. URL берётся из `HEALTHCHECK_PING_URL` или
`/etc/anoon-healthcheck-ping` и в git не лежит — знающий его глушит алерт откуда
угодно. Пока файла нет, поведение прежнее (только `health.log`).

Включить: завести проверку на healthchecks.io (period 5m, grace 15m), затем
`echo '<ping-url>' > /etc/anoon-healthcheck-ping && chmod 600 /etc/anoon-healthcheck-ping`.

## Следующее

- Живой проект Supabase → вход в админку и первый оператор.
- Ping-URL внешнего монитора (см. выше) — заводится владельцем.
- Выгрузка бэкапов наружу: сейчас дампы лежат на том же диске, что и БД.
- RAM 4 ГБ и swap 4 ГБ: при росте нагрузки первым делом апгрейд сервера.

Тестовые учётки (`smoke.*`, `#00001`/`#00002`) снесены — в базе остался только
ROOT-бот `anoonbot` и системный топик `sys`.
