# Тест anoon на телефоне — БЕСПЛАТНО (ваш ПК как сервер + Cloudflare Tunnel)

Эта инструкция поднимает весь стек anoon на вашем ПК и открывает его наружу по
**HTTPS** через бесплатный Cloudflare Tunnel — чтобы можно было зайти с телефона,
установить PWA и проверить камеру/микрофон (всё это работает только по HTTPS).

## Как это устроено (важно понять один раз)

Перед всеми сервисами ставится один обратный прокси — **Caddy** на порту `:80`.
Он собирает три сервиса в **ОДИН origin**:

```
                         ┌────────────────────────────────────┐
   телефон ──HTTPS──►  Cloudflare Tunnel  ──►  Caddy :80 ──►   │
   (trycloudflare.com)                          ├─ /api/*   → companion :6062
                                                ├─ /v0/*    → tinode    :6061
                                                └─ всё      → frontend  :3001
                                                              (/anoon, /_next, ...)
```

Фронтенд обращается к бэкенду по **относительным путям того же origin**
(`/api`, `/v0/channels`) — поэтому случайный URL туннеля, который **меняется при
каждом перезапуске cloudflared**, ничего не ломает. Никакой env менять между
запусками не нужно.

> ⚠️ Обязательное условие: фронтенд должен быть запущен с
> **`NEXT_PUBLIC_SAME_ORIGIN=1`** — только тогда он использует относительные
> same-origin пути. Без флага он будет стучаться на `localhost:6062/6061`, что с
> телефона недоступно.

---

## 0. Что установить (один раз)

### Caddy
- **winget:** `winget install CaddyServer.Caddy`
- **scoop:**  `scoop install caddy`
- **вручную:** https://caddyserver.com/download (скачать `caddy.exe`, положить в PATH)

Проверка: `caddy version`

### cloudflared
- **winget:** `winget install --id Cloudflare.cloudflared`
- **scoop:**  `scoop install cloudflared`
- **вручную:** https://github.com/cloudflare/cloudflared/releases (файл
  `cloudflared-windows-amd64.exe`, переименовать в `cloudflared.exe`, положить в PATH)

Проверка: `cloudflared --version`

> Бесплатный режим `--url` (quick tunnel) НЕ требует аккаунта Cloudflare и логина.

---

## 1. Поднять 3 сервиса

### Бэкенд: tinode (:6061) + companion (:6062) — через Docker
Из папки `server-stack/`:

```powershell
docker compose up -d
```

Проверка, что оба контейнера живы:

```powershell
docker compose ps
```

Должны быть `anoon-tinode` (порт 6061) и `anoon-companion` (порт 6062).

### Фронтенд: frontend (:3001) — с флагом same-origin
Из папки `frontend/`. Флаг можно задать разово в команде (PowerShell):

```powershell
$env:NEXT_PUBLIC_SAME_ORIGIN = "1"
npm run dev
```

…либо, чтобы не забывать, добавить строку в `frontend/.env.local`:

```
NEXT_PUBLIC_SAME_ORIGIN=1
```

и просто `npm run dev`.

> Остальные NEXT_PUBLIC_TINODE_WS / NEXT_PUBLIC_COMPANION_URL при включённом флаге
> игнорируются (хост берётся из адреса страницы), но пусть остаются — для обычной
> localhost-разработки без флага.

Убедитесь, что фронт открывается локально: http://localhost:3001/anoon

---

## 2. Запустить Caddy (обратный прокси)

Из папки `server-stack/` (там лежит `Caddyfile`):

```powershell
caddy run
```

Оставьте это окно открытым. Теперь всё доступно на одном origin:
http://localhost/anoon (порт 80).

> Если `:80` занят (IIS, Skype и т.п.) — освободите его или поменяйте `:80` в
> `Caddyfile` на, например, `:8080`, и тогда в шаге 3 указывайте
> `--url http://localhost:8080`.

---

## 3. Открыть наружу через Cloudflare Tunnel

В отдельном окне:

```powershell
cloudflared tunnel --url http://localhost:80
```

cloudflared напечатает строку вида:

```
+--------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:                  |
|  https://random-words-here.trycloudflare.com                       |
+--------------------------------------------------------------------+
```

Скопируйте этот `https://xxxx.trycloudflare.com`.

> 🔁 Этот URL **меняется каждый раз**, когда вы перезапускаете cloudflared. Это
> нормально — благодаря same-origin режиму ничего перенастраивать не нужно,
> просто откройте новый адрес на телефоне.

---

## 4. На телефоне

1. Откройте в браузере телефона: **`https://xxxx.trycloudflare.com/anoon`**
   (тот самый URL из шага 3, с `/anoon` в конце).
2. Установить как PWA (иконку на домашний экран):
   - **iPhone / Safari:** кнопка «Поделиться» → **«На экран „Домой“»** →
     «Добавить».
   - **Android / Chrome:** меню ⋮ → **«Установить приложение»** /
     «Добавить на главный экран».
3. Запускайте с домашнего экрана — откроется в полноэкранном PWA-режиме,
   камера/микрофон работают (origin по HTTPS).

---

## Итог: что должно быть запущено одновременно

| # | Что            | Команда / где                    | Порт |
|---|----------------|----------------------------------|------|
| 1 | tinode + companion | `docker compose up -d` (server-stack) | 6061 / 6062 |
| 2 | frontend       | `npm run dev` (frontend, SAME_ORIGIN=1) | 3001 |
| 3 | Caddy          | `caddy run` (server-stack)       | 80   |
| 4 | cloudflared    | `cloudflared tunnel --url http://localhost:80` | — |

Окна 3 и 4 держите открытыми на время теста. Закрыли cloudflared — туннель
пропал; запустили снова — получите **новый** URL.

## Быстрая диагностика

- **С телефона белый экран / ошибки сети:** забыли `NEXT_PUBLIC_SAME_ORIGIN=1` —
  перезапустите `npm run dev` с флагом.
- **`/anoon` открывается, но чат/рулетка не коннектятся:** проверьте, что бэкенд
  жив (`docker compose ps`) и Caddy запущен; в консоли браузера телефона запросы
  должны идти на `/api/...` и `wss://<тот же хост>/v0/channels`, а не на
  `localhost`.
- **`:80` не слушается:** порт занят — см. примечание в шаге 2.
