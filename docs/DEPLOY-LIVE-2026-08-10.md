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

## Следующее

- Живой проект Supabase → вход в админку и первый оператор.
- Бэкапы: ночной `pg_dump` обеих БД + выгрузка наружу (в `DEPLOY-PROD.md` есть
  раздел, крон не заведён).
- Внешний монитор на `/api/health` — у companion нет healthcheck (distroless).
- Тестовые учётки `smoke.alpha`, `smoke.beta`, `smoke.test.one` и пара
  `#00001`/`#00002` остались в базе — снести перед реальным запуском.
- RAM 4 ГБ и swap 4 ГБ: при росте нагрузки первым делом апгрейд сервера.
