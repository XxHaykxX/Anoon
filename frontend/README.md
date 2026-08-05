# Anoon — фронтенд

Тёмное мобильное приложение (PWA) на русском, бренд-цвет жёлтый `#FDBF2D`. Два режима в одном аппе:
анонимная **чат-рулетка 18+** (знакомства по `#ID`, раскрытие профиля → друзья) и обычный **мессенджер**
(личка с друзьями). Раньше проект назывался *anoon*.

Стек: **Next.js 16 + React 19 + Tailwind v4 + TypeScript**.

## Запуск
```bash
npm install
npm run dev        # → http://localhost:3001
npm run check      # lint + typecheck + build
```

## Страницы
- **`/`** — витрина: все экраны в light+dark телефон-фреймах (переключение вкладками).
- **`/anoon`** — реальный навигируемый апп (auth-флоу + Главная→Поиск→Чат + нижняя навигация).

## Структура
- `src/components/screens/` — мессенджер-стиль экраны (Onboarding, Chats, Chat, Voice, Music, Contacts, Account, Desktop).
- `src/components/anoon/` — 25 экранов рулетки/друзей + `AnoonApp` (шелл), `_shared.tsx` (BottomNav/Avatar/Logo), `anoonNav.ts`.
- `src/components/` — переиспользуемые (VoiceMessage, MediaBubble, AnoonMediaViewer, EmojiPicker, CallScreen, …).
- `src/app/globals.css` — токены (light `:root` + `.dark`), жёлтый primary, кастомные `--bubble-*`/`--online`/`--read-tick`.
- `public/` — PWA: `manifest.webmanifest`, `sw.js`, иконки.

## Дизайн
- Тёмная+светлая темы. Аватары = градиент+инициалы (плейсхолдеры, не фото).
- Клонирован из макетов в `../anoon/` (см. `docs/design-references/`). Значения — визуально приближённые.

## Бэкенд
Отдельно: `../anoon/server-stack/` (self-hosted Tinode из исходника). Фронт пока на моковых данных;
подключение к серверу — следующий этап. Общий статус: `../anoon/PROJECT-STATUS.md`.
