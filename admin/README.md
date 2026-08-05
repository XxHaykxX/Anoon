# anoon-admin

Админ-панель модерации анонимного чат-приложения **anoon** (v2).
Стек: **Next.js 15 + Refine + shadcn/ui + Tailwind + Framer Motion**. Тёмная бренд-тема `#000`/`#FDBF2D`.
Дизайн-система: [`DESIGN.md`](./DESIGN.md) · План: [`PLAN.md`](./PLAN.md) · Вопросы владельцу: [`questions.md`](./questions.md) · Прогресс: [`PROGRESS.md`](./PROGRESS.md).

> Строится schema-first (см. `../packages/db/prisma/schema.prisma`), UI сначала на mock-провайдере — бэкенд v2 (Hono) ещё не существует.

## Setup

```bash
# из папки admin/
pnpm install
cp .env.example .env.local   # заполнить значения
```

Требования: Node 22+, pnpm.

## Run (mock-режим — без бэкенда)

```bash
NEXT_PUBLIC_DATA_MODE=mock pnpm dev
# → http://localhost:3000 — логин-экран + данные из фикстур/MSW
```

## Run (реальный API)

```bash
NEXT_PUBLIC_DATA_MODE=api pnpm dev
```
Требует поднятого admin-API (Next Route Handlers поверх общей Prisma; позже — Hono v2).

## Env

Полный список — в [`.env.example`](./.env.example). Ключи без `NEXT_PUBLIC_` — только сервер.

## Deploy

Vercel, `Root Directory=admin`. Preview на PR + отдельная preview-БД. Секреты — в Vercel env (server-only).

## Приватность (обязательно)

- email-hash / providerId / IP в UI **не показываются**.
- Просмотр приватного контента — только по жалобе, с причиной, **аудируется** (`ModeratorAction`).
- Медиа — **blur-by-default**; противоправный контент — эскалация, не свободный просмотр.
