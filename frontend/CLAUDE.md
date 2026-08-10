# Anoon frontend — заметки для агентов

Продукт **anoon** (бывш. *anoon*): тёмная PWA, русский, жёлтый `#FDBF2D`. Анонимная чат-рулетка 18+
(`#ID`, раскрытие профиля → друзья) + мессенджер. Стек: Next.js 16 / React 19 / Tailwind v4 / TS.

## Конвенции
- Каждый экран: `"use client"`, корень `<div className="relative flex h-full w-full flex-col bg-background text-foreground">`, рассчитан на телефон-фрейм 390×844.
- Только Tailwind + токены из `globals.css` (`bg-background`, `text-muted-foreground`, `bg-primary`, `bg-bubble-out`, `text-online`, `text-read-tick`, `border-border`, …). Хардкод hex — только бренд `#FDBF2D` при необходимости.
- Аватары — всегда `AnoonAvatar` из `@/components/anoon/_shared`. По умолчанию градиент+инициалы; фото рисуется, только если передан `photoUrl` (своё фото в профиле; чужое — лишь там, где оно легально видно: друзья и раскрытая пара). Нет URL или картинка не загрузилась — обратно к градиенту. Свой `<img>` вместо этого пропа не заводить.
- Press-фидбек: `active:scale-95 transition-transform cursor-pointer`. Новые пузыри — класс `anoon-msg-in`.
- Кнопки/тумблеры должны реально работать (useState), без мёртвых.
- Иконки из `@/components/icons`; недостающие — локальный `const XIcon = (p) => (<svg .../>)`, НЕ править `icons.tsx`.

## Карта
- `src/components/screens/` — мессенджер-стиль. `src/components/anoon/` — рулетка/друзья + `AnoonApp`/`anoonNav`/`_shared`.
- Витрина в `src/app/page.tsx` (вкладки). Реальный апп в `src/app/anoon/page.tsx`.
- PWA в `public/` (`manifest.webmanifest`, `sw.js`), регистрация в `src/components/PWARegister.tsx` (mounted в `layout.tsx`).

## Проверка
`npm run check` (lint+typecheck+build). Скриншоты — playwright MCP (НЕ gstack browse). Статус проекта: `../anoon/PROJECT-STATUS.md`.
