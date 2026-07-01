# anoon web

Анонимный чат-знакомства (PWA). Стек: Next.js 16 + Tailwind v4 + shadcn/ui + Zustand + framer-motion.
Тёмная тема `#000` / акцент `#FDBF2D`. Профиль = только ник + #ID + онлайн.

План и статус этапов: [`PLAN.md`](./PLAN.md).

## Разработка

```bash
pnpm install
cp .env.example .env.local   # заполни NEXT_PUBLIC_VAPID_PUBLIC_KEY (для push)
pnpm dev                     # http://localhost:3000
```

Данные пока на моках (Zustand, локально). WS-бэкенд (Bun+Hono+Socket.io) и R2 для медиа — этап v2.
Медиа (фото/видео/голос) хранятся как локальные object URL — на сервер не грузятся.

## Проверки

```bash
npx tsc --noEmit   # типы
pnpm build         # прод-сборка
pnpm lint          # eslint
```

### E2E (Playwright)

```bash
pnpm exec playwright install --with-deps   # один раз (браузеры)
pnpm e2e                                    # прогон e2e/ (сам поднимает dev-сервер)
```
Скелет: `e2e/onboarding.spec.ts`, `e2e/chat.spec.ts`. Медиа/голос/push — `test.skip`
(нужен secure-context/бэкенд). Ручной чеклист: `../docs/ui-test-checklist.md`.

## Деплой (Vercel)

- Root Directory: `web/` (монорепо; `admin/` деплоится отдельно).
- Framework preset: Next.js — сборка/output определяются автоматически, спец-конфиг не нужен.
- Env: задать `NEXT_PUBLIC_VAPID_PUBLIC_KEY` в настройках проекта Vercel.
- PWA: `public/manifest.webmanifest` (standalone, `#000`) + service worker `public/sw.js`
  (только Web Push, без офлайн-precache — см. TODO в `sw.js`). SW регистрируется из
  `components/app-providers.tsx`.
- Web Push: клиентская подписка реальная (Notification + PushManager), рассылка — TODO(backend):
  сохранять `PushSubscription` в `packages/db` и слать через `web-push` приватным VAPID-ключом.

> Не запускать реальный деплой без ревью — бэкенд v2 ещё не подключён.
