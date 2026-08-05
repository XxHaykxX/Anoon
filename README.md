# anoon

Единая папка проекта. Собрана 2026-08-05 из трёх бывших папок
(`frontend`, `anoon`, `anoon`).

## Структура

| Папка | Что это | Технология |
|---|---|---|
| `frontend/` | Приложение anoon. `/` — витрина всех экранов (эталон дизайна), `/anoon` — рабочий апп | Next.js 16 + React 19 + Tailwind v4 |
| `server/` | Исходники Tinode v0.25.2 (клон upstream, свой git) | Go |
| `server-stack/` | Docker-сборка сервера + companion + Caddy + coturn | Docker Compose |
| `webapp/` | Штатный веб-клиент Tinode, который отдаёт сервер | — |
| `admin/` | Админка (перенесена из старого проекта anoon) | Next.js + Refine |
| `docs/` | Все планы и статусы. Главный файл — `PROJECT-STATUS.md` | — |
| `deploy/`, `Design/` | Деплой и дизайн-материалы | — |
| `_archive/anoon-old/` | Старый проект anoon на Supabase. Не используется, лежит для истории | — |

`server/`, `server-stack/`, `webapp/` обязаны оставаться соседями —
`server-stack/docker-compose.yml` ссылается на них относительными путями.

## Запуск

```bash
# 1. Бэкенд (Tinode :6061, gRPC :16061, companion :6062)
docker compose -f server-stack/docker-compose.yml up -d

# 2. Фронтенд
cd frontend && npm run dev -- -p 3001

# 3. Прокси (нужен: в .env.local включён режим одного домена)
cd server-stack && ./bin/caddy.exe run --config Caddyfile.phone
```

Открывать **http://localhost:8088/anoon** (не :3001 — на голом :3001 бэкенд не подключится,
потому что в `frontend/.env.local` стоит `NEXT_PUBLIC_SAME_ORIGIN=1`).

Витрина экранов: **http://localhost:8088/**

Тестовые аккаунты: `alice_test/alicepass123`, `bob_test/bobpass123`.
