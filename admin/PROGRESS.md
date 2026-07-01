# anoon-admin — Прогресс (loop-трекер)

> Ведётся автономным loop. Каждая итерация: сделать шаг по PLAN.md → отметить здесь → продолжить.
> Решения по рекомендациям questions.md; юр/приватность — безопасный дефолт.

## Этап 0 — Схема + каркас (в работе)

- [x] Общая Prisma-схема `packages/db/prisma/schema.prisma` (User/Profile/Report/Ban/AdminUser/ModeratorAction/MediaAsset + enums).
- [x] `admin/.env.example` (server-only ключи, NEXT_PUBLIC_DATA_MODE).
- [x] `admin/README.md` (setup/run mock/api/deploy/privacy).
- [x] Скаффолд Next.js 15 (ts/tailwind-v4/app/src) → влит в `admin/`; node_modules пересобран.
- [x] Refine v5 + shadcn-база + framer-motion + медиа-либы (yet-another-react-lightbox, vidstack). **Next 16.2.9 / React 19.2** (свежие мажоры — сверялся с node_modules/next/dist/docs).
- [x] Бренд-токены Tailwind из DESIGN.md (#000/#FDBF2D, OLED) + a11y-фиксы (muted #8A8A8A, warning смещён, focus-ring гало, hard reduced-motion) в `globals.css`.
- [x] Mock dataProvider (in-memory фикстуры) `providers/mock-data-provider.ts` + `data/fixtures.ts`.
- [x] Admin authProvider (mock-заглушка, реальная = отдельная система) + логин-экран `/login`.
- [x] Layout: `RefineProviders` + `AdminShell` (сайдбар сгруппир. nav + топбар с поиском); гейт `Authenticated`.
- [x] Страницы: `/reports` (лендинг=очередь), `/users` (таблица), `/bans`, `/overview` (стат-карты). Root → redirect `/reports`.
- [x] tsc --noEmit = 0 ✅
- [x] `next build` = 0 ✅ (7 роутов prerendered; починен `/_not-found` через `<Suspense>` вокруг Refine-провайдеров — router использует useSearchParams).
- [x] **Smoke прод-сервера: GET /login → HTTP 200** («anoon · admin»), / → 200. ✅
- [ ] Framer Motion анимации (stagger/hover/modal) — Этап 1+.
- [x] **Критерий Этапа 0 выполнен: логин-экран на моках рендерится.** ЭТАП 0 ЗАКРЫТ.

## Этап 1 — Очередь жалоб (ядро) ✅ (tsc+build зелёные)
- [x] Очередь-triage `/reports`: клавиатура (J/K/B/X), выбор строки, motion stagger (first-paint) + exit-анимация.
- [x] **Бан-диалог** `ban-dialog.tsx`: confirm + обязательная причина (чипы+коммент) + срок (перм/7д/30д), scrim 55%, modal-motion (scale+fade), Esc-закрытие.
- [x] **Аудит** `lib/audit.ts` + страница `/audit` (журнал: бан/разбан/мут/отклонение/эскалация + время). Каждое действие пишется.
- [x] **Тост** `ui/toaster.tsx` (framer-motion, aria-alert, авто-скрытие 3.5с), смонтирован в AdminShell.
- [x] Проводка: `/reports` бан/отклонить, `/users` бан (диалог), `/bans` снять — через useUpdate + аудит + тост.
- [x] Эскалация: жалобы `illegal` помечены бейджем «Эскалация» (безопасный дефолт, без свободного просмотра).
- [ ] Двухпанельный detail-вид (пока однопанельный список) — доп. позже.

## Этап 3 — Медиа-ревью (safe) ✅ (tsc+build зелёные)
- [x] Мок медиа-ассетов в `data/fixtures.ts` (owner/kind image|video, r2-заглушка picsum + sample-video, ephemeral, deletedAt для «истёкшего», escalated, reportReason).
- [x] `MediaGallery` `components/media-gallery.tsx`: сетка тайлов, **blur-by-default** (blur-xl + оверлей «Показать»), клик снимает блюр только для тайла; stagger first-paint.
- [x] Lightbox `yet-another-react-lightbox` + Zoom (свайп/зум); видео-слайды рендерятся кастомно через vidstack.
- [x] Видеоплеер `components/video-player.tsx` (@vidstack/react) — **muted + без автоплея** (старт с паузы), `load=visible`, грузится через `dynamic(ssr:false)` (web-components). Доустановлены peer-deps `vidstack@0.6.15` + `maverick.js@0.37.0`.
- [x] Состояние «медиа удалено/истекло» (deletedAt) — плашка `ImageOff` вместо тайла.
- [x] **CSAM/illegal**: кнопка «Эскалировать» на тайле → блокирует элемент (оверлей `Lock` «Заблокировано — передано на эскалацию»), НЕ даёт смотреть; пишет `ModeratorAction type=escalate` в аудит.
- [x] Галерея подключена к `/users/[id]` (страница деталей) — БЕЗ просмотра переписки (плашка приватности), с бан-диалогом. Ник в `/users` кликабелен → детали.

## Этап 2 — Пользователи + Bulk + Audit-log ✅ (tsc+build зелёные)
- [x] Мультивыбор (чекбоксы + «выбрать все») в /users и /reports; хук `lib/use-selection.ts`.
- [x] Sticky `BulkBar` (`components/bulk-bar.tsx`): счётчик + действия + «снять выделение» (X).
- [x] `ConfirmDialog` (`components/confirm-dialog.tsx`) для bulk: /users «Забанить выбранных»; /reports «Забанить выбранных»/«Отклонить выбранные». Каждое действие → аудит + тост.
- [x] Виртуализация /users при >50 (`@tanstack/react-virtual`, spacer-rows в table, sticky thead, без stagger); для мок-данных (4 строки) — обычный рендер.

## Этап 3 — Медиа-ревью (safe)
- [ ] Галерея blur-by-default + lightbox/vidstack, CSAM-эскалация, proxy R2, «медиа удалено».

## Этап 4 — Обзор + Баны + полиш ✅ (tsc+build+lint зелёные)
- [x] /overview: стат-карты с hover-анимацией (scale 1.02 **только на pointer:fine** через `lib/use-can-hover.ts`, не на touch), иконки lucide, tabular-nums, мини-тренд (мок), stagger first-paint.
- [x] /bans: фильтр-табы Активные/Истёкшие/Снятые (aria-tab, счётчики), в фикстуры добавлены expired+lifted примеры, stagger.
- [x] Полиш AdminShell: переход страниц (fade+slide-up 8px, 200ms), скользящий индикатор nav через `layoutId` (spring), `aria-current` на активном пункте.
- [x] A11y: aria-label на иконках-кнопках (эскалация/чекбоксы/bulk-close/reveal), focus-ring из globals.css, reduced-motion hard, только transform/opacity.
- [x] Lint: исправлен pre-existing `set-state-in-effect` в ban-dialog (паттерн правки состояния в рендере); warning virtualizer подавлен точечно. `pnpm lint` = 0.
- [x] Smoke прод-сервера (3100): login/overview/reports/users/bans/audit/users/[id] → все HTTP 200.

## Журнал
- 2026-07-01 — Этап 0 старт: общая Prisma-схема + .env.example + README + этот трекер. Тулинг проверяется для скаффолда.
- 2026-07-01 — Этап 3 (Медиа-ревью safe) ЗАКРЫТ: fixtures медиа, MediaGallery (blur-by-default), lightbox+Zoom, vidstack-плеер (muted/no-autoplay, ssr:false), плашка «удалено», CSAM-эскалация с аудитом, страница /users/[id] без переписки. Доустановлены vidstack+maverick.js. tsc=0, build=0 (10 роутов, /users/[id] динамический).
- 2026-07-01 — Этап 2 (добивка Bulk) ЗАКРЫТ: use-selection, BulkBar, ConfirmDialog, мультивыбор в /users и /reports, виртуализация /users при >50 (@tanstack/react-virtual). tsc=0, build=0.
- 2026-07-01 — Этап 4 (Обзор+Баны+полиш) ЗАКРЫТ: стат-карты с hover (не на touch) + тренд, фильтр банов active/expired/lifted, переход страниц + скользящий nav (layoutId), a11y, lint-фиксы. tsc=0, build=0, lint=0, smoke все роуты 200. ВСЕ ЭТАПЫ 3/2/4 ГОТОВЫ.
