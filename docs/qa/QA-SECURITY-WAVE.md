# QA — приёмка волны безопасности (H1, H2, M1, M3/M4, L1–L3)

> Составлен 2026-08-06 по фактическим диффам рабочего дерева, не по описанию задачи.
> Стенд: приложение на `http://localhost:8088/anoon`, аккаунты `admin1/admin1` (#00011, м)
> и `admin2/admin2` (#00012, ж). companion в dev торчит на `localhost:6062`,
> Tinode — `6061`/`16061`, контейнеры `anoon-companion`, `anoon-tinode`, `anoon-tinode-db`.
>
> На момент составления: `go build ./...` — OK, `go test ./internal/...` — все пакеты
> проходят, `npx tsc --noEmit` во фронте — чисто. Агенты ещё дописывали код, поэтому
> §1.5 и §5.6 — про расхождения, которые надо перепроверить на смёрдженном дереве.

---

## 0. Предусловия и порядок (читать до всего остального)

Пункты в этом порядке; нарушение каждого даёт сбой, который выглядит не тем, чем является.

### 0.1 Пересобрать companion и применить миграцию 0010 — ЖЁСТКОЕ предусловие

```bash
cd /c/Users/Admin/Desktop/anoon/server-stack
docker compose build companion && docker compose up -d companion
docker compose logs --tail=40 companion
```

Миграции идут сами при старте (`main.go` → `db.Migrate`), поэтому на проде это
не проблема. Бьёт оно ровно по **устаревшему локальному стенду** — то есть по тому,
против чего этот чек-лист и запускают. Проверить, что 0010 действительно легла, до
всего остального:

```bash
docker compose exec db psql -U postgres -d anoon -tAc \
  "SELECT to_regclass('roulette_matches') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='roulette_matches' AND column_name='alias_a');"
# ОЖИДАЕТСЯ: t   ← если f, дальше не идти

docker compose exec db psql -U postgres -d anoon -c \
  "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3;"
# ожидается 0010_roulette_anon_alias.sql первой строкой

docker compose exec db psql -U postgres -d anoon -c "\d roulette_matches"
# ожидается: alias_a text NOT NULL, alias_b text NOT NULL
```

**Почему это отдельный пункт, а не «ну очевидно же».** `MatchByTopic`
(`store/roulette.go:157-171`) теперь сканирует `alias_a`/`alias_b`. На БД без миграции
запрос падает **ошибкой скана**, а не `ErrNoRows`, и новая проверка участия
(`topicMemberFor`, `media.go:157-180`) считает любую ошибку стора за «не участник».
Отказ безопасный, но наружу он выглядит как сломанная авторизация, а не как отсутствующая
колонка: жалоба из анон-чата → `404 no_match`, блок → `404 no_match`,
`POST /media` с `topic` → `403 not_in_topic`, эскалация медиа не происходит, релеи
(`msg:del`, `peer:left`, `activity`, звонок по алиасу) молча пропадают. Полная таблица
симптомов и порядок распознавания — §4.1.

На **совсем** устаревшей БД вы упрётесь в это ещё раньше: `CreateMatch` вставляет
`alias_a`/`alias_b`, INSERT падает, `onMatch` возвращает пару в очередь и оба
пользователя вечно висят на «Поиске» (`roulette: persist match failed, re-queuing pair`
в логе), а `GET /roulette/status` отдаёт `500 store_failed`.

### 0.2 Переменные окружения

| Переменная | Значение для этого прогона | Что будет, если забыть |
|---|---|---|
| `ENV` | **`dev`** (в `docker-compose.yml` уже `${ENV:-dev}`) | **Дефолт в коде теперь `prod`.** Запуск companion руками (`go run .`) без `ENV` упадёт на `config: CORS_ALLOWED_ORIGINS is required when ENV=prod`, а с `COMPANION_DEV_AUTH=1` — на `refusing to start with the auth bypass live in production`. Похоже на «сломали конфиг», на деле это и есть L-фикс |
| `COMPANION_REST_SECRET` | `openssl rand -hex 32` — задать для §2.1 | Пусто → `/auth/rest` отвечает **503 `rest_auth_disabled`**, а не 401. Тест H1 «атака отбита» пройдёт по ложной причине |
| `COMPANION_ADMIN_TOKEN_SECRET` | **оставить пустым** на первом прогоне | См. 0.3 |
| `COMPANION_ADMIN_SECRET` | любое непустое — иначе весь `/admin/*` = 503 | 503 вместо 401 на всех админ-проверках |
| `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST` | `5` / `20` для §2.3; в dev по умолчанию **0 = выключено** | Лимитер не включён, `rateLimited()` возвращает хендлер как есть, 429 никогда не придёт |

### 0.3 Порядок включения attested-режима админки — критично

Админка **уже умеет** слать токен: `admin/src/lib/companion-client.ts:72` добавляет
`X-Admin-Token`, когда есть cookie сессии. Порядок обязателен:

1. Сначала выкатить админку (этот код) и убедиться, что заголовок реально уходит.
2. Только потом задать `COMPANION_ADMIN_TOKEN_SECRET` = `ADMIN_SESSION_SECRET` админки.

Наоборот — **каждый** запрос к `/admin/*` будет отбит companion, панель потемнеет
целиком, и это будет выглядеть как «сломался admin secret», хотя shared-secret в порядке.
Первый прогон делать в legacy-режиме (ключ пуст), attested — отдельным проходом §2.4b.

**Внимание на статус: в браузере вы 401 НЕ увидите.** companion отвечает
`401 invalid_admin_token`, но роут админки ловит исключение и перепаковывает его —
`companionFetch` бросает `Error(body.error)` (`admin/src/lib/companion-client.ts:99`),
а обработчики отдают своё:

| Раздел админки | Статус в браузере | Файл |
|---|---|---|
| списки (reports, users, bans) | **400** | `api/admin/[resource]/route.ts:39` |
| overview | **400** | `api/admin/overview/route.ts:63,106` |
| chats | **400** | `api/admin/chats/route.ts:140` |
| media (детальный путь) | **400** | `api/admin/media/route.ts:217` |
| media (список) и broadcast | **502** | `media/route.ts:100`, `broadcast/route.ts:48` |

Тело при этом честное — `{"error":"invalid_admin_token"}`, по нему и диагностировать.
И наоборот: **настоящий 401** от админки (`[resource]/route.ts:21`) означает совсем
другое — нет cookie-сессии оператора, то есть проблема в самой админке, а не в companion.
Итого: `401` → залогиньтесь в панель; `400`/`502` с `invalid_admin_token` в теле →
это как раз рассинхрон ключа.

Дополнительно: `COMPANION_ADMIN_TOKEN_SECRET` короче 16 символов роняет companion на
старте с явным сообщением — это специально, полуприклеенный ключ хуже отсутствующего.
**Следствие для тестов «сломай нарочно»:** подсовывать заведомо неверный ключ можно
только длиной ≥16 символов. Более короткий даст мёртвый контейнер, а не 401/400, и
диагностировать будете не то.

### 0.4 Пересобрать/перезапустить фронт

Поменялись типы и имена полей событий. Dev-сервер Next перехватит сам, но прод-сборку
фронта надо пересобрать, иначе старый бандл будет читать `peerHashId` из `matched` и
показывать `—` вместо псевдонима.

### 0.5 Разово: почистить старые активные матчи (см. §4.2)

```bash
docker compose exec db psql -U postgres -d anoon -c \
  "SELECT id, topic, status, alias_a, alias_b FROM roulette_matches WHERE status='active';"
```

Если есть строки, созданные **до** миграции, у них алиас из `md5()` (см. §4.2) —
закрыть их перед прогоном:

```bash
docker compose exec db psql -U postgres -d anoon -c \
  "UPDATE roulette_matches SET status='ended', ended_at=now() WHERE status='active';"
```

---

## 1. Дрейф контракта (наивысший приоритет)

H2 переименовал поля, помеченные в `hub.go:77-78` как замороженные
(«the frontend decodes these exactly»).

### 1.1 Что именно поменялось на проводе

| Событие | Было | Стало | Файл |
|---|---|---|---|
| `matched` | `peerHashId` (настоящий #ID) | `peerAlias` (`~K7X2QM`) | `internal/api/hub.go:87-92` |
| `reveal_request` | `fromHashId` | `fromAlias` | `hub.go:96-100` |
| `revealed` | `peerHashId` | **без изменений** — единственный кадр с реальной личностью | `hub.go:104-109` |
| `friend_request` / `friend_accepted` | `fromHashId` / `hashId` | **без изменений** | `hub.go:111-127` |
| `call:*`, `msg:del`, `peer:left`, `activity` — поле `from` | всегда `#00012` | алиас в анон-фазе, `#ID` после раскрытия | `callsignal.go:250-262` (`relayFrom`) |
| `call:*` — поле `to` (входящее) | только `#ID` | `#ID` **или** алиас | `callsignal.go:266-296` (`resolveRelayTarget`) |
| `POST /reports` | `reportedHashId` обязателен | `reportedHashId` **опционален**, `topic` — второй способ адресации | `reports.go:22-27` |
| `POST /roulette/block` | `{hashId}` | `{topic}` (приоритетно) либо `{hashId}` | `block.go:14-20` |
| `GET /roulette/status` → `match` | `peerHashId` | `peerAlias` (тот же тип, что WS) | `roulette.go:186-200` (`anonMatchedEvent`) |

### 1.2 Полный список потребителей — проверено

Сканировал `frontend/src/**`, `frontend/tests/e2e/**` (включая `real/`), `frontend/*.mjs`
(QA-харнессы), витрину и `admin/**`. **Тип-уровневый дрейф отсутствует**: `npx tsc --noEmit`
проходит чисто, а `MatchedEvent.peerAlias` объявлен обязательным
(`frontend/src/types/companion.ts:197`), так что любой оставшийся читатель `ev.peerHashId`
был бы ошибкой компиляции.

Обновлённые потребители (проверять не нужно, перечислены для полноты):

| Файл:строка | Что |
|---|---|
| `frontend/src/types/companion.ts:197,210` | `peerAlias` / `fromAlias` в событиях |
| `frontend/src/types/companion.ts:128,130` | `RouletteMatch.peerAlias` (новое) + `peerHashId` (стало опциональным) |
| `frontend/src/store/slices.ts:1560` | `applyMatched` кладёт `peerAlias`, `peerHashId` оставляет `undefined` до раскрытия |
| `frontend/src/store/slices.ts:1606-1610` | `reveal_request` больше не читает поле отправителя; `revealed` по-прежнему `e.peerHashId` |
| `frontend/src/components/anoon/AnoonAnonChat.tsx:423-427` | шапка: `#ID` если раскрыт, иначе алиас, иначе `—` |
| `frontend/src/components/anoon/AnoonAnonChat.tsx:625-627` | исходящий звонок: `to` = `#ID` или алиас |
| `frontend/src/components/anoon/AnoonAnonChat.tsx:725` | блок → `blockAnonPeer(topic)` |
| `frontend/src/components/anoon/AnoonApp.tsx:352-354` | входящий звонок: `from` может быть алиасом, имя — «Собеседник ~K7X2QM» |
| `frontend/src/store/callStore.ts:26-27` | поле `peerHashId` теперь документировано как «#ID **или** алиас» |
| `frontend/src/components/anoon/AnoonReport.tsx:38-62` | цель жалобы: `#ID` при наличии, иначе только `topic` |
| `frontend/src/lib/companion.ts:421` | `block(hashId)` → `blockAnonPeer(topic)` |
| `frontend/src/lib/companion.ts:186-192, 884-895` | mock-драйвер шлёт `peerAlias`/`fromAlias` в правильном алфавите |
| `admin/src/lib/companion-client.ts:68-73` | админ-заголовки + новый `X-Admin-Token` |

### 1.3 Устаревшие моки и фикстуры — найдено три, все безвредны, но проверить глазами

Ни один не даёт «зелёный тест при сломанном проде», но все три показывают на экране
реалистичный `#ID` там, где прод теперь показывает `~`:

1. **`frontend/src/components/anoon/AnoonAnonChat.tsx:44,427`** — `const PARTNER_ID = "#04217"`.
   Используется только в ветке `!real` (витрина). Прод-путь (`real === true`) идёт через
   `peerAlias`. **Действие:** ничего не ломает; поменять на `~`-форму, чтобы витрина не
   учила смотрящего, что в анон-чате виден `#ID`.
2. **`frontend/src/app/showcaseFixtures.tsx:76-77`** — `peerName="Собеседник" peerId="#04217"`.
   То же самое, витрина. **Действие:** то же.
3. **`frontend/src/components/anoon/AnoonReport.tsx:48`** — фолбэк-подпись
   `"Собеседник #04821"`, когда цель не определилась вовсе. Виден, только если экран
   жалобы открыт без активного матча и без открытого чата. **Действие:** косметика.

**Мок, который был бы опасен, — обновлён корректно:** `frontend/src/lib/companion.ts:884-895`
(`mockMatch`) теперь эмитит `peerAlias` из того же алфавита без `0/1/I/O`
(`MOCK_ALIAS_ALPHABET`, строка 186), а `#ID` появляется только в `mockRevealed`
(строка 907). Если бы он остался на `peerHashId`, весь UI-mock прогон E2E был бы
зелёным при сломанном проде — этого не произошло.

### 1.4 E2E-ассерты по тексту — три места, все переживают переименование

| Файл:строка | Ассерт | Вердикт |
|---|---|---|
| `frontend/tests/e2e/roulette.spec.ts:27` | `getByText("Собеседник", {exact:false})` | Проходит и с алиасом — подстрока |
| `frontend/tests/e2e/notifications.spec.ts:16,24` | `"Собеседник #04821"`, `"Собеседник #01390"` **точно** | Это строки заявок в друзья (`fromHashId`), путь не менялся. Проходят |
| `frontend/tests/e2e/report-block.spec.ts:44` | `"Собеседник заблокирован"` | Флеш-сообщение (`AnoonAnonChat.tsx:731,1083`), текст не менялся |
| `frontend/tests/e2e/real/helpers.ts:147`, `real/reveal.spec.ts:86` | `"Собеседник хочет открыть профиль"` | Текст prompt-а, не зависит от handle |

Ни один спек не ассертит `peerHashId` анон-пира напрямую — потому что UI его и раньше
показывал только внутри строки «Собеседник #…».

### 1.5 Форма отчёта и админ-заголовки — проверить на смёрдженном дереве

- `POST /reports` со стороны фронта: `AnoonReport.tsx:60` шлёт
  `reportedHashId: peerHashId || undefined`. Сервер (`reports.go:63-77`) принимает:
  `#ID` → глобальный резолв; иначе `topic` → участник. **Проверить**, что никакой другой
  вызывающий `report()` не полагается на обязательность `reportedHashId` —
  на момент проверки единственный вызов именно этот.
- **Расхождение источника ключа админ-токена.** `config.go:208,245` завёл
  `Config.AdminTokenSecret` (с `TrimSpace` и минимумом 16 символов), `router.go:81` —
  поле `Server.AdminTokenSecret []byte`, **но** `admin.go:76` всё ещё читает
  `adminTokenSecret()`, который берёт `os.Getenv` напрямую и **не тримит**
  (`admin.go:154-162`, под `sync.Once`). Пока обе ветки живы: ключ с хвостовым пробелом
  пройдёт валидацию конфига в тримленном виде и будет использован в нетримленном →
  подпись не сойдётся → все `/admin/*` = 401.
  **Действие при приёмке:** убедиться, что `adminIdentity` вызывается с
  `s.AdminTokenSecret`, а package-level `adminTokenSecret()`/`sync.Once` удалён.

---

## 2. Проверка по каждой находке

Для каждой — «атака отбита» **и** «легальный путь жив». Второе важнее: фикс, который
рубит и атакующего, и пользователя, — не фикс.

### 2.1 H1 — `/auth/rest` требует секрет и не проксируется наружу

**Атака отбита (без секрета):**

```bash
# Через публичный вход (Caddy) — путь не должен существовать вовсе
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/json" -d '{"endpoint":"rtagns"}' \
  http://localhost:8088/api/auth/rest
# ОЖИДАЕТСЯ: 404   (Caddyfile.phone: handle /api/auth/rest* { respond 404 })

# Прямо в companion, без секрета
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"endpoint":"rtagns"}' http://localhost:6062/auth/rest
# ОЖИДАЕТСЯ: {"error":"unauthorized","message":"invalid rest auth secret"}  (401)

# Разрушительная ветка, ради которой всё делалось
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"endpoint":"del","rec":{"uid":"<uid жертвы>"}}' http://localhost:6062/auth/rest
# ОЖИДАЕТСЯ: 401. И строка oauth_identities жертвы на месте:
docker compose exec db psql -U postgres -d anoon -c \
  "SELECT provider, subject FROM oauth_identities;"
```

**Легальный путь жив (с секретом), обе позиции:**

```bash
S="$COMPANION_REST_SECRET"
# 1) заголовок
curl -s -X POST -H "Content-Type: application/json" -H "X-Companion-Rest-Secret: $S" \
  -d '{"endpoint":"rtagns"}' http://localhost:6062/auth/rest
# ОЖИДАЕТСЯ: {"ts":"0001-01-01T00:00:00Z"} или {"strarr":[]} — 200, безобидная ветка

# 2) basic-auth (именно так секрет доедет от Tinode — через userinfo в server_url)
curl -s -X POST -H "Content-Type: application/json" -u "tinode:$S" \
  -d '{"endpoint":"rtagns"}' http://localhost:6062/auth/rest
# ОЖИДАЕТСЯ: то же 200

# 3) хвостовой слэш — Tinode дописывает его сам (auth_rest.go Init)
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" \
  -u "tinode:$S" -d '{"endpoint":"rtagns"}' http://localhost:6062/auth/rest/
# ОЖИДАЕТСЯ: 200 (router.go регистрирует оба написания)
```

**Честная оговорка про «Tinode всё ещё аутентифицируется через rest».**
Сквозной прогон этого пути **на текущем стенде невозможен**: блока `rest`-аутентификатора
в конфиге Tinode нет вообще (`server/server/tinode.conf` — совпадений по `"rest"` ноль,
в `server-stack/` конфига с `server_url` тоже нет). Сегодня Google-вход в приложении идёт
через собственный брокер companion — `POST /auth/oauth/google` (`router.go:141`), а не
через этот хук. Практический вывод:

- сегодня риск сломать вход этим фиксом **нулевой** — хук никем не вызывается;
- проверка §2.1 «легальный путь» = три curl выше, этого достаточно;
- **когда блок `rest` будут настраивать**, обязателен отдельный прогон: `server_url`
  вида `http://companion:8080/auth/rest` с userinfo `https://tinode:SECRET@…`,
  затем живой вход через Google и проверка, что в логе companion есть
  `auth/rest: linked google user, #ID=…`. Секрет брать **только hex** (`openssl rand -hex 32`):
  он едет внутри URL, и любой `@`, `:`, `/` его порвут.

### 2.2 H2 — псевдоним вместо `#ID` в анонимной фазе

**Атака отбита.** Два браузера, `admin1` и `admin2`, оба «Рулетка» → «Начать чат».

1. В шапке анон-чата у обоих — `~` и шесть символов, **никаких `#00011`/`#00012`**.
2. В DevTools → Network → WS-кадр `matched`: есть `peerAlias`, поля `peerHashId` нет.
3. `GET /roulette/status` тем же аккаунтом — тот же `peerAlias`, **тот же самый**, что в
   WS-кадре (это отдельная проверка: пути не должны разъезжаться, `anonMatchedEvent`
   существует ровно ради этого):
   ```bash
   curl -s -H "Authorization: Bearer <токен admin1>" \
     http://localhost:6062/roulette/status | jq .
   ```
4. Пуш о новом сообщении (заблокировать вкладку получателя, отправить сообщение):
   в теле уведомления **алиас**, не `#ID` (`message_push.go:94-105`).
5. Кадр `activity`/`peer:left`/`msg:del` у получателя: `from` = алиас
   (`callsignal.go:250-262`).
6. Взять алиас собеседника и попробовать найти его в «Поиск по #ID» — **не находится**
   (это не `#ID` и не резолвится глобально).
7. Чужой алиас неприменим третьим лицом: сформировать WS-кадр
   `{"type":"call:offer","to":"<алиас из чужого матча>","callId":"x"}` от третьего
   аккаунта → должен прийти `call:unavailable`, а не звонок
   (`MatchByPeerAlias` скоупится по `viewerID`, `store/roulette.go:184-206`).

**Легальный путь жив:**

- **Звонок внутри анон-чата** — кнопка звонка в анон-чате, вторая сторона звонит.
  Это самый новый и самый непокрытый код (`resolveRelayTarget` + `MatchByPeerAlias`),
  и **ни один E2E-спек его не трогает** (см. §3).
- **Жалоба из анон-чата** → 201, и в БД цель проставлена:
  ```bash
  docker compose exec db psql -U postgres -d anoon -c \
    "SELECT id, reporter_id, reported_id, topic FROM reports ORDER BY id DESC LIMIT 3;"
  ```
  `reported_id` должен быть реальным id собеседника, хотя клиент `#ID` не посылал.
- **Блок из анон-чата** → флеш «Собеседник заблокирован», и строка появилась:
  ```bash
  docker compose exec db psql -U postgres -d anoon -c \
    "SELECT user_id, friend_id, status FROM friendships WHERE status='blocked';"
  ```
  После этого повторный матч этой пары не должен происходить (exclude-set).
- **Раскрытие** → у обоих в шапке появляется настоящий `#00011`/`#00012`, событие
  `revealed` несёт `peerHashId`, пара становится друзьями.
- **После раскрытия** звонок продолжает работать уже по `#ID`.

### 2.3 M1 — rate-limit включён и XFF не обходится

Включить: `RATE_LIMIT_RPS=5`, `RATE_LIMIT_BURST=20`, перезапустить companion.
В логе: `rate limiting enabled: 5 rps, burst 20 (per user + per IP)`.

**Атака отбита — подделка XFF больше не даёт свежее ведро:**

```bash
# 40 запросов с РАЗНЫМ поддельным первым хопом. Раньше каждый получал новое ведро.
for i in $(seq 1 40); do
  curl -s -o /dev/null -w "%{http_code} " -X POST \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 1.2.3.$i" \
    -d '{"login":"nope","password":"nope"}' \
    http://localhost:6062/auth/register
done; echo
# ОЖИДАЕТСЯ: первые ~20 — 4xx от самой ручки, дальше пойдут 429.
```

Через Caddy (`:8088`) — то же, но подделанный хоп уходит влево от того, что дописал
Caddy, и не читается (`ratelimit.go:171-200`, берётся **последний** хоп).

**Легальный путь жив:**

- Обычная работа приложения двумя аккаунтами — ни одного 429 в Network. UI не выдаёт
  и близко 5 rps.
- Локальный `curl` **без** прокси не должен уметь себя разлимитить заголовком:
  `trustedPeer` (`ratelimit.go:205-215`) доверяет XFF только от приватного/loopback пира.
  На dev-стенде пир как раз loopback/бридж, то есть доверенный, — поэтому проверку
  «XFF игнорируется у недоверенного пира» на этом стенде **честно проверить нельзя**,
  она проверяется юнит-тестом: `go test ./internal/api/ -run RateLimit -v`.
- Проверить `Retry-After` в ответе 429 (целые секунды, ≥1).

### 2.4a M3 — роль админа, legacy-режим (дефолт, должен продолжать работать)

`COMPANION_ADMIN_TOKEN_SECRET` пуст. В логе companion при старте должна быть строка
про `COMPANION_ADMIN_TOKEN_SECRET unset — … not a privilege boundary`.

```bash
A="$COMPANION_ADMIN_SECRET"
# легальный путь: админка ходит так же, как раньше
curl -s -H "X-Companion-Admin-Secret: $A" -H "X-Admin-Id: 1" -H "X-Admin-Role: super_admin" \
  http://localhost:6062/admin/overview | jq .
# ОЖИДАЕТСЯ: 200 с данными

# роль по-прежнему подделываема — это ЗАДОКУМЕНТИРОВАННОЕ поведение legacy-режима
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH -H "X-Companion-Admin-Secret: $A" \
  -H "X-Admin-Id: 1" -H "X-Admin-Role: moderator" -H "Content-Type: application/json" \
  -d '{"action":"unban"}' http://localhost:6062/admin/users/1
# ОЖИДАЕТСЯ: 403 forbidden (гейт срабатывает на роль из заголовка)

# неизвестная роль схлопывается в moderator, а не расширяет права
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH -H "X-Companion-Admin-Secret: $A" \
  -H "X-Admin-Role: SUPER_ADMIN " -H "Content-Type: application/json" \
  -d '{"action":"unban"}' http://localhost:6062/admin/users/1
# ОЖИДАЕТСЯ: 403 — normalizeRole (admin.go:165-171) сравнивает строго
```

**Прогнать всю админку** (`ADMIN_BACKEND=companion`): reports, users, bans, overview,
online, media, broadcast — legacy-режим шипится как дефолт, регресс здесь дороже фикса.

### 2.4b M3 — attested-режим (отдельным проходом, только после §0.3)

Задать `COMPANION_ADMIN_TOKEN_SECRET` = `ADMIN_SESSION_SECRET` админки, перезапустить.

- Легальный путь: зайти в админку под оператором, открыть любой список → 200.
  В `moderator_actions` авторство = `sub` из токена, а не то, что прислали заголовком.
- Атака: тот же запрос с `X-Admin-Id: 999` / `X-Admin-Role: super_admin`, **но без**
  `X-Admin-Token` → `401 invalid_admin_token` (заголовки игнорируются целиком).
- Просроченный/подписанный чужим ключом токен → 401.
- Токен с `alg: none` → 401 (`jwt.WithValidMethods(["HS256"])`, `admin.go:120-135`).

### 2.5 M4 — origin-проверка на WebSocket

```bash
# Чужой origin отбивается
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Origin: https://evil.example" \
  "http://localhost:6062/ws?token=<валидный токен>"
# ОЖИДАЕТСЯ: 403
```

- Легальный путь: приложение на `http://localhost:8088` держит `/ws` живым (зелёная
  точка онлайна, приходят события). В логе companion **не должно** быть
  `ws: upgrade failed (origin=…)`.
- **Отдельно проверить:** запрос **без** заголовка `Origin` (нативный клиент, curl)
  проходит намеренно (`ws.go:29-40`, `wsOriginAllowed` пропускает пустой origin).
  Убедиться, что это осознанное решение команды, а не дыра в проверке: браузер
  всегда шлёт Origin, так что для браузерной атаки это не лазейка, но и не «всё закрыто».

### 2.6 L1 — жалоба и эскалация медиа только для участника

- **Легальный путь:** пожаловаться из анон-чата и из чата с другом → 201 в обоих.
- **Атака:** пожаловаться, подставив `topic` чужого разговора:
  ```bash
  curl -s -X POST -H "Authorization: Bearer <токен admin1>" -H "Content-Type: application/json" \
    -d '{"category":"spam","topic":"grp<чужой топик>","reportedHashId":"#00012"}' \
    http://localhost:6062/reports
  ```
  Сама жалоба **создаётся** (это claim, отказывать нельзя — так и задумано,
  `reports.go:94-97`), но эскалации быть не должно: в логе строка
  `reports: not escalating topic … is not in it with user …`, и в БД:
  ```bash
  docker compose exec db psql -U postgres -d anoon -c \
    "SELECT id, topic, owner_id, escalated FROM media_assets ORDER BY id DESC LIMIT 10;"
  # ОЖИДАЕТСЯ: escalated=false у чужих строк
  ```
- **Легальная эскалация работает:** отправить медиа в анон-чате, пожаловаться с этим
  `topic` → `escalated=true` у строк этого топика.
### 2.6b L1 — эскалация медиа в p2p-чате: класс регрессии, до волны неверный В ОБЕ стороны

Это не «ужесточили проверку», а починили сам выбор строк, и старое поведение промахивалось
дважды. Имена p2p-топиков **пер-юзерные**: медиа, отправленное A в чат с B, лежит под
топиком `usrB`, а медиа B в том же разговоре — под `usrA`. Старый одиночный
`EscalateMediaByTopic(usrB)`:

- **захватывал лишнее** — помечал медиа **всех** пользователей, отправленное B, во всех
  посторонних чатах с B;
- **пропускал главное** — медиа самого́ обвиняемого (оно лежит под `usrA`), то есть ровно
  ту улику, ради сохранения которой эскалация и существует.

Теперь это две owner-scoped ноги: `(usrB, owner=репортёр)` и `(usrA, owner=обвиняемый)` —
`reports.go:127-139` (`escalationLegs`) и `store/media.go:266-281`
(`EscalateMediaByTopicOwner`).

**Как проверить.** Нужны три аккаунта: `admin1` (репортёр), `admin2` (обвиняемый) и любой
третий `C`. Подружить `admin1`↔`admin2` и `C`↔`admin2`.

1. В чате `admin1`↔`admin2`: оба отправляют по медиа.
2. В чате `C`↔`admin2`: `C` отправляет медиа (это «посторонний третий», который раньше
   попадал под раздачу).
3. `admin1` жалуется на `admin2` **из их общего чата** (topic = `usr<uid admin2>`).
4. Смотреть строки:

```bash
docker compose exec db psql -U postgres -d anoon -c \
  "SELECT id, owner_id, topic, escalated, left(url, 24) AS ref
     FROM media_assets ORDER BY id DESC LIMIT 12;"
```

Ожидается:

| Чьё медиа | Ожидаемый `escalated` | Почему |
|---|---|---|
| `admin1` в чате с `admin2` | **true** | нога `(usrB, owner=репортёр)` |
| `admin2` в чате с `admin1` | **true** | нога `(usrA, owner=обвиняемый)` — **раньше пропускалось** |
| `C` в чате с `admin2` | **false** | **раньше ошибочно помечалось** |

> **Оговорка, без которой шаг невыполним:** флаг `escalated` в кодовой базе сейчас
> **никто не читает** — задания очистки, которое бы его уважало, ещё нет. Поэтому
> проверяется он **только осмотром строк в БД**, командой выше. Писать ассерт вида
> «медиа не удалилось через TTL» бессмысленно: удалять его пока всё равно некому.
> Смысл шага — зафиксировать, что выборка строк стала правильной, до того как
> появится потребитель, который на неё положится.

Если аккаунта `C` под рукой нет, минимальный вариант — п. 1, 3, 4 без третьей стороны:
он ловит «пропускали медиа обвиняемого» (вторая строка таблицы), но не ловит
«захватывали лишнее».

### 2.7 L2 — `POST /media` проверяет URL и участие

```bash
T="Bearer <токен admin1>"
# Атака 1: посторонний URL
curl -s -X POST -H "Authorization: $T" -H "Content-Type: application/json" \
  -d '{"url":"https://evil.example/x.png","kind":"image"}' http://localhost:6062/media
# ОЖИДАЕТСЯ: 400 invalid_url

# Атака 2: обход префикса
curl -s -X POST -H "Authorization: $T" -H "Content-Type: application/json" \
  -d '{"url":"/v0/file/s/../../etc/passwd","kind":"image"}' http://localhost:6062/media
# ОЖИДАЕТСЯ: 400 invalid_url

# Атака 3: подложить медиа в чужой разговор
curl -s -X POST -H "Authorization: $T" -H "Content-Type: application/json" \
  -d '{"url":"/v0/file/s/abc123","kind":"image","topic":"grp<чужой>"}' http://localhost:6062/media
# ОЖИДАЕТСЯ: 403 not_in_topic

# Легальный путь: без topic
curl -s -X POST -H "Authorization: $T" -H "Content-Type: application/json" \
  -d '{"url":"/v0/file/s/abc123","kind":"image"}' http://localhost:6062/media
# ОЖИДАЕТСЯ: 201
```

**Главная легальная проверка — живая загрузка:** отправить фото в анон-чате и в чате с
другом через UI. Оба должны долететь и появиться в `media_assets`. Если формат ref-а,
который отдаёт `uploadFile` в `frontend/src/lib/tinode.ts`, отличается от
`/v0/file/s/<id>` хоть на символ — **вся загрузка медиа отвалится с 400**, и это самый
вероятный способ сломать пользователя этим фиксом (см. §4.3).

### 2.8 L3 — отписка от пушей только своя

- **Легальный путь:** в Настройках выключить уведомления → строка исчезла:
  ```bash
  docker compose exec db psql -U postgres -d anoon -c \
    "SELECT user_id, left(endpoint, 40) FROM push_subscriptions;"
  ```
- **Атака:** взять endpoint `admin2` из таблицы и отписать его токеном `admin1`:
  ```bash
  curl -s -X POST -H "Authorization: Bearer <токен admin1>" -H "Content-Type: application/json" \
    -d '{"endpoint":"<endpoint admin2>"}' http://localhost:6062/push/unsubscribe
  # ОЖИДАЕТСЯ: 200 (намеренно молчит, чтобы не разглашать чужие endpoint-ы),
  # НО строка admin2 в push_subscriptions ОСТАЁТСЯ на месте — это и есть проверка.
  ```
- Проверить, что серверная чистка протухших подписок жива: путь отправителя по-прежнему
  зовёт `DeletePushSubscription` (без скоупа) — на 404/410 от push-сервиса подписка
  должна удаляться.

---

## 3. Регрессия

### 3.1 Покрыто существующими E2E — прогнать как есть

```bash
cd /c/Users/Admin/Desktop/anoon/frontend
npm run test:e2e                       # UI-mock режим
E2E_REAL=1 npm run test:e2e            # живой бэкенд, 2 аккаунта
cd ../server-stack/companion && go test ./internal/...
go test -tags integration ./internal/integration/... -v   # нужен живой стек
```

| Сценарий | Спек | Комментарий |
|---|---|---|
| Логин / регистрация | `login.spec.ts`, `register.spec.ts` | Затронуто косвенно (rate-limit на `/auth/*`) |
| Рулетка → чат (mock) | `roulette.spec.ts` | Ассерт по подстроке «Собеседник» — переживает |
| Жалоба + блок | `report-block.spec.ts` | **Ключевой**: оба API поменяли форму запроса |
| Матч → раскрытие → друзья (живой) | `real/reveal.spec.ts`, `real/helpers.ts:ensureFriends` | Главный сквозной путь H2 |
| Звонки между **друзьями** | `real/calls.spec.ts` | Только `#ID`-путь, см. 3.2 |
| Медиа | `real/media.spec.ts` | Прямо бьётся об L2 |
| Реакции / чтение / правка-удаление | `real/reactions`, `receipts`, `reply-edit-delete` | `msg:del` теперь стемплен алиасом |
| Уведомления | `notifications.spec.ts` | Путь заявок в друзья, не менялся |

### 3.2 Не покрыто ничем — нужен ручной проход (двумя аккаунтами; для п. 4b — тремя)

Это список того, что после этой волны **никем не проверяется автоматически**:

1. **Звонок внутри анонимного чата (аудио и видео).** `real/calls.spec.ts` вызывает
   `ensureFriends`, который сразу же раскрывает профили, поэтому звонит уже
   **друзьям по `#ID`**. Анон-путь через алиас (`resolveRelayTarget` →
   `MatchByPeerAlias`) — самый новый код волны и полностью вне тестов.
   Проверить: звонок из анон-чата в обе стороны, приём, сброс, у вызываемого в
   плашке — «Собеседник ~…», а не `#ID`.
2. **`call:unavailable` в анон-фазе** — позвонить, когда собеседник закрыл вкладку.
3. **Пуш о сообщении** — тело с алиасом (§2.2 п.4). Автотестов на пуши нет вовсе.
4. **View-once медиа + эскалация по жалобе** — `media.spec.ts` не трогает
   `escalated`.
4b. **Эскалация в p2p-чате, трёхсторонний сценарий (§2.6b)** — класс регрессии, до этой
   волны неверный в обе стороны. Автотестов нет и быть не может, пока у флага
   `escalated` нет ни одного потребителя: проверяется осмотром строк `media_assets`.
5. **Админка целиком против companion** — E2E у админки нет; прокликать вручную
   (§2.4a), обязательно в legacy-режиме, он шипится дефолтом.
6. **`peer:left` / «Собеседник покинул чат»** в анон-фазе — есть в `qa-chat.mjs:562`,
   но это отдельный харнесс, не часть `npm run test:e2e`.
7. **Google-вход** — на этом стенде не сконфигурирован (§2.1), проверять нечего,
   но и зелёного сигнала «не сломали» тоже нет.

---

## 4. Ранжированный список рисков — что смотреть первым

### 4.1 🔴 Непринятая миграция 0010 выглядит как баг авторизации, а не как баг схемы

Самый дорогой сценарий не «что-то сломали», а «час ушёл не туда». Если companion
поднялся на **устаревшей БД** (миграции не прогонялись — типовая ситуация локального
стенда, а не прода, где `main.go` мигрирует на старте), то `MatchByTopic`
(`store/roulette.go:157-171`) падает не на `sql.ErrNoRows`, а на **ошибке скана**:
колонок `alias_a`/`alias_b` в таблице нет. Новая проверка участия
(`topicMemberFor`, `media.go:157-180`) трактует **любую** ошибку стора как «не участник».

Отказ происходит в безопасную сторону — это правильно, — но наружу это выглядит
как сломанные права:

| Действие | Симптом на устаревшей БД | Что подумает проверяющий |
|---|---|---|
| Жалоба из анон-чата | `404 no_match` «that topic is not a conversation you are in» (`reports.go:73-75`) | «L1 сломал жалобы, проверка участия слишком строгая» |
| Блок из анон-чата | `404 no_match` «no such match» (`block.go:46-48`) | то же |
| `POST /media` с `topic` | `403 not_in_topic` | «L2 не пускает в собственный чат» |
| `msg:del` / `peer:left` / `activity` / звонок по алиасу | молча не доставляется | «H2 сломал релеи» |
| Эскалация медиа по жалобе | не происходит вовсе, в логе `reports: not escalating topic …` | «L1 не работает» |

**Что вы увидите РАНЬШЕ этого** (и почему список выше — второй эшелон): на полностью
устаревшей БД матч вообще не создаётся. `CreateMatch` вставляет `alias_a`/`alias_b`,
INSERT падает, `onMatch` возвращает пару в очередь — оба пользователя вечно висят на
«Поиске», в логе `roulette: persist match failed, re-queuing pair`. А
`GET /roulette/status` отдаёт `500 store_failed`, потому что `ActiveMatchForUser`
сканирует те же колонки. Симптомы из таблицы вы поймаете, только если в БД остались
строки матчей, созданные **до** апгрейда бинаря.

**Проверять первым — одной командой:**

```bash
docker compose exec db psql -U postgres -d anoon -tAc \
  "SELECT to_regclass('roulette_matches') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='roulette_matches' AND column_name='alias_a');"
# ОЖИДАЕТСЯ: t
```

Если `f` — остановиться и разобраться с миграцией (§0.1), **не** заводить баг на L1/L2/H2.

### 4.2 🔴 Legacy-матчи получили алиас, который сервер сам не принимает

`0010_roulette_anon_alias.sql:22-24` заполняет старые строки значением
`'~' || upper(substr(md5(random()::text), 1, 6))` — то есть hex-символами `0-9A-F`.
Валидатор `store.NormalizeAlias` (`store/roulette.go:107-125`) принимает только алфавит
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — **без `0` и `1`** (их выкинули ради читаемости).
Вероятность, что случайные 6 hex-символов не содержат ни `0`, ни `1`, — `(14/16)^6 ≈ 45%`.
То есть **больше половины строк, созданных до миграции, получают алиас, который
`NormalizeAlias` отвергает**, а значит `MatchByPeerAlias` вернёт `ErrNoMatch`.

Последствие: в анон-чате, начатом **до** деплоя и ещё активном, звонок и `activity`,
адресованные по алиасу, молча не работают (`call:unavailable`). Отображение и `msg:del`
по `topic` при этом работают — поэтому баг выглядит как «звонки иногда не проходят».

**Что делать:** §0.5 — закрыть все активные матчи перед прогоном. Само по себе это
самоизлечивается по мере завершения старых чатов, но на проде это окно надо закрыть
осознанно. **Проверить первым:**
```bash
docker compose exec db psql -U postgres -d anoon -c \
  "SELECT count(*) FROM roulette_matches WHERE status='active' AND (alias_a ~ '[01]' OR alias_b ~ '[01]');"
# ОЖИДАЕТСЯ: 0
```

### 4.3 🔴 Формат ref-а медиа: одна строка отсекает всю загрузку

`media.go:50` требует ровно префикс `/v0/file/s/` плюс один сегмент без `/ \ ? #`.
Если `uploadFile` во фронте отдаёт абсолютный URL, другой префикс, query-строку
(`?...`) или хоть один слэш внутри — **каждая** загрузка медиа получит `400 invalid_url`.
Юнит-тесты этого не поймают: они проверяют валидатор, а не то, что реально отдаёт Tinode.
**Проверить вторым:** живая отправка фото через UI (§2.7), и посмотреть в Network,
что именно ушло в `POST /media`.

### 4.4 🟠 Attested-режим админки при неготовой админке

Задать `COMPANION_ADMIN_TOKEN_SECRET` раньше времени = отбой на **каждом** админ-запросе,
панель полностью тёмная. Плюс живое расхождение источника ключа (§1.5): `os.Getenv`
без `TrimSpace` против валидации в конфиге с `TrimSpace`. Ключ с невидимым пробелом
на конце пройдёт старт и завалит все запросы.

Две ловушки диагностики, обе разобраны в §0.3:
- **в браузере это не 401.** companion отвечает 401, но роут админки перепаковывает его
  в **400** (почти везде) или **502** (broadcast и список media). Тело —
  `{"error":"invalid_admin_token"}`. Настоящий 401 значит другое: нет cookie-сессии;
- **«сломать нарочно» коротким ключом нельзя.** Ключ короче 16 символов роняет companion
  на старте — получите мёртвый контейнер вместо отказа в авторизации.

**Проверить:** первый прогон в legacy, attested — отдельно и осознанно.

### 4.5 🟠 `ENV` по умолчанию стал `prod`

Любой запуск companion мимо compose (`go run .`, новый unit-файл, CI-шаг) теперь падает
на старте. Сообщения внятные (`CORS_ALLOWED_ORIGINS is required when ENV=prod`), но если
кто-то читает только «companion не стартует» — потеряется час.
**Проверить:** `docker compose logs companion` содержит `environment: ENV=dev`.

### 4.6 🟠 Звонки в анон-фазе — новый непокрытый код

`resolveRelayTarget` + `MatchByPeerAlias` + round-trip `from`→`to` (собеседник отвечает,
echo-я обратно тот handle, который получил). Ошибка здесь ломает звонки только внутри
рулетки — то есть в сценарии, который ни один спек не проходит.
**Проверить:** §3.2 п.1 руками.

### 4.7 🟡 `onMatch` теперь перезапрашивает пару при ошибке записи матча

`roulette.go:398-406`: раньше не записанный матч был «best-effort», теперь пара
возвращается в очередь, а созданный топик Tinode **остаётся осиротевшим**. Это
осознанное решение (нечем назвать собеседника без алиасов), но при частых сбоях БД
даёт утечку пустых grp-топиков.
**Проверить:** в логе после прогона нет `roulette: persist match failed`.

### 4.8 🟡 Rate-limit включается в проде впервые

`compose.prod.yml` пиннит `5 rps / burst 20`. На локальном стенде по умолчанию 0.
Реальный риск — не 429 у пользователя (UI и близко не выдаёт 5 rps), а то, что
**никто не заметит опечатки в значении**, пока не приедет прод.
**Проверить:** §2.3 на dev с явно заданными значениями.

### 4.9 🟡 Витрина и фолбэки всё ещё показывают правдоподобный `#ID`

`AnoonAnonChat.tsx:44`, `showcaseFixtures.tsx:76-77`, `AnoonReport.tsx:48`.
Функционально безвредно, но витрина — это то, что показывают людям, и она сейчас учит,
что в анонимном чате виден `#04217`.

---

## 5. Быстрый чек-лист «прошло / не прошло»

- [ ] **0010 применена** (`alias_a` в `information_schema.columns` → `t`) — проверять
      ПЕРВЫМ; при `f` всё ниже даст ложные «баги авторизации», см. §4.1
- [ ] Активных матчей с `0`/`1` в алиасе — ноль
- [ ] `ENV=dev` в логе companion; сервис поднялся
- [ ] `/api/auth/rest` через Caddy → 404; напрямую без секрета → 401; с секретом (заголовок и basic) → 200
- [ ] `matched` и `/roulette/status` отдают **один и тот же** `peerAlias`, `peerHashId` отсутствует
- [ ] Пуш о сообщении в анон-фазе содержит `~`, не `#`
- [ ] Жалоба и блок из анон-чата работают без `#ID`; чужой `topic` не эскалирует медиа
- [ ] p2p-эскалация (§2.6b): медиа обвиняемого помечено, медиа постороннего третьего — нет
- [ ] Звонок внутри анон-чата проходит в обе стороны (**ручной**)
- [ ] Раскрытие → `#ID` появляется, друзья создаются, звонок по `#ID` работает
- [ ] Медиа грузится через UI (не только curl)
- [ ] Отписка от пушей чужим токеном не удаляет чужую строку
- [ ] WS с чужим Origin → 403; приложение живёт без `ws: upgrade failed` в логе
- [ ] Админка (legacy) полностью функциональна; роль из заголовка гейтит destructive-действия
- [ ] `go test ./internal/...`, `npm run test:e2e`, `E2E_REAL=1 npm run test:e2e` — зелёные
- [ ] `npx tsc --noEmit` во фронте — чисто
- [ ] `admin.go` берёт ключ из `s.AdminTokenSecret`, а не из `os.Getenv` (§1.5)
