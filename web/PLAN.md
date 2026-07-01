# anoon web — Основное приложение (чат-знакомства v2)

> Источник: `../dating_app_full_plan_v2.html`. Анонимный чат в стиле nekto.me.
> Стек: **Next.js 16 + Tailwind v4 + shadcn/ui + Zustand + Socket.io-client + PWA (Serwist)**.
> Тёмная тема `#000` + `#FDBF2D`. Профиль = только **ник + #ID + онлайн**, больше ничего.
> Frontend-first на моках; WS-бэкенд (Bun+Hono+Socket.io) — позже. Общая БД: `../packages/db`.

## Анонимность (ядро)
- Показываем: ник (выбирает сам), #ID (напр. #00001), онлайн-статус.
- НЕ показываем: фото/аватар, возраст, пол, город, «о себе», телефон/email.

## Что можно в чате
- Текст (WebSocket, realtime), фото/видео (R2), голосовые.
- «Найти случайного собеседника» — подбор онлайн-юзера.

## Этапы (из плана v2)
### Этап 1 — Основа ✅ (tsc+build зелёные)
- [x] Онбординг `components/onboarding.tsx`: ник → #ID (Zustand `store/session.ts` + persist localStorage).
- [x] Экран поиска `components/find-peer.tsx`: «Найти» (мок-матчинг → /chat/<peer>), бренд-свечение.
- [x] Текстовый чат `app/chat/[id]/page.tsx` (`store/chat.ts` мок-эхо+автоответ, пузырьки, Enter-отправка, автоскролл, framer-motion).
- [x] PWA-манифест `public/manifest.webmanifest` (standalone, #000, theme_color) + viewport/appleWebApp в layout. [ ] иконки 192/512 (нужны ассеты).
- [x] **Liquid Glass** (`@samasante/liquid-glass`, MIT) — glass-карточка профиля на экране поиска над бренд-свечением. ⚠️ полная рефракция — Chrome/Edge; iOS Safari/Firefox → frost+tint (наше PWA мобильное). Рендер после mount (без SSR).
- Гейт `app/page.tsx`: нет профиля → онбординг, есть → поиск (mounted-guard от SSR-mismatch).
### Этап 2 — Медиа ✅ (tsc зелёный)
- [x] Фото в чате (кнопка → пузырёк-картинка picsum), голосовые (кнопка mic → пузырёк-войс с waveform+длительность). `store/chat.ts` kind text|image|voice.
- [x] PWA-иконка `public/icon.svg` (бренд, maskable) + манифест обновлён.
- [x] **Реальный выбор файла** фото/видео (`input[type=file]` accept image/video), object URL, probe размеров/длительности, **превью-бар перед отправкой** (отмена/отправить) — `components/chat-composer.tsx`. `store/chat.ts` расширен: kind +video, w/h, реальные url.
- [x] **Реальная запись голоса** через MediaRecorder (`lib/use-voice-recorder.ts`): старт/стоп/отмена, таймер, fallback denied/unsupported; воспроизведение blob с прогрессом (`components/voice-bubble.tsx`).
- [x] **Просмотр по тапу**: полноэкранный лайтбокс (`components/media-lightbox.tsx`) фото/видео — Esc/тап-фон/свайп-вниз, framer-motion.
- [x] Рефактор `chat/[id]/page.tsx`: пузырь → `components/message-bubble.tsx`, composer вынесен в `components/chat-composer.tsx`. tsc=0.
### Этап 3 — Полиш ✅ (tsc+build+lint зелёные)
- [x] **Web Push (VAPID)**: клиентские хелперы `lib/push.ts` (реальные Notification+PushManager, подписка), стор `store/push.ts` (persist намерения), тумблер `components/push-toggle.tsx` (в хедере экрана поиска), service worker `public/sw.js` (push/notificationclick), регистрация в `components/app-providers.tsx`. Рассылка = TODO(backend), VAPID public из env.
- [x] **Блок/жалоба**: меню три-точки `components/chat-menu.tsx` в хедере чата → «Пожаловаться» (`components/report-dialog.tsx`, выбор причины + коммент) / «Заблокировать» (confirm → выход на /). Мок-стор `store/moderation.ts` (TODO: WS/API + общая схема packages/db).
- [x] **Тёмная тема финал**: `MotionConfig reducedMotion="user"` (framer-motion уважает prefers-reduced-motion), тач-цели ≥44px (h-11) на всех кнопках, #000/#FDBF2D, контраст AA (fg-muted #8a8a8a).
- [x] **Деплой-подготовка**: `.env.example` (NEXT_PUBLIC_VAPID_PUBLIC_KEY), `README.md` (setup + деплой Vercel root=web, PWA/SW заметки). Реальный деплой НЕ запускался.
- Примечание: пункт «иконки 192/512» этапа 1 закрыт `public/icon.svg` (maskable).

## Дизайн
- Тёмный фон `#000`, акцент `#FDBF2D` (жёлтый), карточки скруглённые, шрифт как в плане (sans).
- Мобайл-first (это телефонное PWA), крупные тач-цели ≥44px, нижняя навигация.
- Анимации плавные (framer-motion), reduced-motion.

## Замечания
- `web/` отдельно от `admin/` (та строится параллельно фоновым агентом).
- Модерация/жалобы данные шарятся с админкой через общую схему `packages/db`.

## Бэкенд-пивот (см. `../docs/ROADMAP.md`)
- Архитектура: **Supabase** (Auth anonymous / Realtime / PostgREST) + `backend/`
  (`@supabase/server`, secret-ключ) вместо Bun+Hono+Socket.io.
- БД `packages/db` (Supabase Postgres): схема+клиент+seed+RLS готовы (Фаза B).
- Realtime чат/матчинг/presence/typing — `web/src/lib/realtime.ts` (Broadcast/Presence,
  Фаза D). Auth — `signInAnonymously` + backend `/profile` (Фаза C, ждёт вкл. тумблера).
- Модерация block/report → backend → БД (Фаза F, при авторизации).
- Env: `web/.env.local` (Supabase URL/publishable, VAPID public). Секреты — в `.env` (gitignore).
