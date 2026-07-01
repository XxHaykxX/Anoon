# anoon-admin — План реализации (черновик для gstack-ревью)

## Цель
Админ-панель модерации для анонимного чата (v2). Красивая, эргономичная, тёмная (#000/#FDBF2D), с богатыми анимациями. Стек: **Next.js 15 + Refine + shadcn/ui + Tailwind + Framer Motion**, данные из **Prisma/Postgres (Supabase)**. Дизайн-система — `admin/DESIGN.md`.

## Область (что модерирует)
- **Пользователи**: ник + #ID + онлайн + счётчик жалоб + дата рег. Действия: бан / разбан / мут / undo.
- **Жалобы**: очередь (кто → на кого, причина, медиа-превью). Действия: бан / отклонить / разобрать.
- **Медиа**: галерея медиа юзера (фото/видео) + лайтбокс + видеоплеер для ревью.
- **Баны**: список активных/истёкших.
- **Обзор**: стат-карточки (всего юзеров, онлайн, жалоб в очереди, банов сегодня).

## Роли
- MVP: одна роль **super-admin** (логин e-mail/пароль). Задел на роль **moderator** (без настроек) — позже.

## Этапы
1. **Каркас** — Next.js 15 app + Refine + shadcn + Tailwind + бренд-токены (DESIGN.md); layout (сайдбар + топбар); dataProvider к API/Prisma; authProvider (login). Framer Motion + reduced-motion.
2. **Пользователи** — UsersTable (сортировка, поиск ник/#ID, виртуализация), инлайн Одобрить/Бан, UserDetailDrawer, stagger-анимации.
3. **Жалобы + Медиа** — ReportsQueue; MediaGallery (yet-another-react-lightbox) + видеоплеер (vidstack) в дровере юзера; действия бан/мут/undo с тостами.
4. **Обзор + Баны + полиш** — стат-карточки, BansList, скелетоны, пустые/ошибочные состояния, приёмка по чеклисту DESIGN.md (контраст, touch, a11y, 375–1440).

## Данные / бэкенд
- Refine `dataProvider`: REST к серверу v2 (Hono) ИЛИ прямой Prisma-провайдер. Решить на ревью.
- Нужны admin-эндпоинты: список юзеров с агрегатом жалоб, бан/мут (флаги в БД), список жалоб, медиа юзера. Модель `Report` + поля `bannedAt/mutedUntil` — добавить в схему v2.
- Авторизация: отдельная admin-роль/гуард (не обычный юзер-JWT).

## Открытые вопросы (для gstack)
- dataProvider: REST vs прямой Prisma?
- Где хранить admin-креды (env) и как гейтить (роль в JWT / отдельная таблица admin)?
- Просмотр переписки юзера — нужно ли (приватность анонимного чата vs модерация)?
- Медиа: presigned URL из R2 напрямую или проксировать через admin-API?
- Отдельный репозиторий/деплой (Vercel) или монорепо с app?

## Риски
- Приватность: админ видит контент анонимных юзеров — минимизировать доступ, логировать действия модератора.
- Медиа из R2: CORS/доступ; ephemeral-медиа могут быть удалены.
- Refine + shadcn: кастом-тема под бренд требует ручной проводки токенов.

---

# GSTACK REVIEW REPORT

> Full-планирование gstack (autoplan-методология). Голоса: Claude-субагенты по 4 лензам. **Codex недоступен → dual-voice деградировал в subagent-only** (документированный путь). Все вопросы к владельцу вынесены в `admin/questions.md`.

## Консенсус-scores (0–10)

| Лена | Низкие места | Score |
|---|---|---|
| CEO | right-problem 3 · premises 2 · sequencing 2 | стратегия/тайминг слабые |
| Design | media-ux 2 · states 4 · hierarchy 5 | безопасность медиа + IA |
| Eng | data-model 3 · security 3 · sequencing 3 · testability 3 | модель/безопасность/порядок |
| DX | local-dev 1 · TTHW 2 · docs 2 | нет mock/scaffold/README |

## Сквозные темы (флаг ≥2 лензами → высокая уверенность)

1. **v2-бэкенд не существует** (CEO+Eng+DX, CRITICAL) → schema-first, mock-провайдер, REST-граница.
2. **Анонимность ↔ «просмотр переписки»** (CEO+Design+Eng, CRITICAL) → продуктово-юр решение (B1), не тумблер.
3. **Медиа-safety отсутствует** (CEO+Design+Eng, CRITICAL) → blur-by-default + CSAM-эскалация.
4. **Аудит-лог модератора** (все 4) → первоклассная фича + модель `ModeratorAction`.
5. **Admin-auth отдельно** (Eng+Design+DX) → `AdminUser`+argon2id+httpOnly+2FA.

## Авто-решения (по 6 принципам; не требуют владельца)

Приняты в план (P1 полнота / P5 явность / P2 blast-radius):
- **Sequencing:** schema-first → тонкий admin-API на Next Route Handlers поверх общей Prisma → UI на моках → репойнт на Hono позже. Границу REST держим с 1-го дня.
- **Mock-first:** `NEXT_PUBLIC_DATA_MODE=mock|api`, фикстуры/MSW — весь UI полируется без бэкенда. Этап 1.
- **Модель данных:** `Report{status,reason,assignedToId,resolvedById,resolvedAt, targetMessageId?}`, `Ban{reason,expiresAt,issuedById,...}` (таблица, не boolean), `ModeratorAction` (аудит), `AdminUser{role}`, media-metadata `{r2Key,mime,duration,deletedAt,expiresAt}`.
- **Auth:** отдельная система (`AdminUser`+argon2id, отдельный ключ/audience JWT, httpOnly-cookie, default-deny middleware, rate-limit на логин). Токены админа/юзера не взаимозаменяемы.
- **Приватность-дефолты:** список/детали не возвращают email-hash/providerId/IP; приватный контент — по j-report, с причиной, аудируется; R2 проксируется через admin-API.
- **UX:** лендинг = очередь жалоб (двухпанельный triage); клавиатурный keymap (J/K/B/X/Enter/Esc + «?»); бан = confirm + причина + срок; bulk-действия (мультивыбор + sticky bar); экран Audit-log.
- **Медиа-safety:** тайлы blur-by-default + «Показать»; видео без автоплея, muted; content-warning бейдж; «Escalate (CSAM)» блокирует элемент; bulk-модерация галереи.
- **A11y-фиксы DESIGN.md:** `--fg-muted #6B7280` не проходит AA на #000 (~4.0:1) → поднять до ~`#8A8A8A` для информативного текста; аннотацию «≥3:1» → «≥4.5:1»; focus-ring на жёлтых поверхностях — контрастный гало (тёмный зазор + жёлтый снаружи); warning-hue сместить от бренд-жёлтого.
- **Анимации:** stagger только на первом paint (никогда на виртуализации/ресорте); reduced-motion = жёстко opacity-only, 0 translate, индикатор nav мгновенный; hover-scale карточек выключать на touch/плотных экранах.
- **Edge-cases:** денормализованный `reportCount` (без N+1); cursor-пагинация; `MediaViewer` состояние «медиа удалено/истекло»; идемпотентность бана (409-паттерн репутации).
- **DX:** монорепо-подпапка `admin/`, Vercel root=admin; `create-refine-app` headless+shadcn (pnpm, Node 22); `admin/.env.example` (server-only ключи без `NEXT_PUBLIC_`) + `admin/README.md` на Этапе 1; критерий Этапа 1 = «`pnpm dev` → логин-экран с mock-провайдером».
- **Тест-план:** auth guard/default-deny (нет токена / юзер-JWT / чужой audience); RBAC на уровне API; ban-каскад + реверс репутации (идемпотентно); mute-enforcement на WS; аудит-полнота (каждая мутация И каждый просмотр приватного → строка); lifecycle жалобы; PII-редакция ответов.

## User Challenge (НЕ авто-решается — только владелец)

**Все лензы: строить админку сейчас — преждевременно** (v2 нет, юзеров нет, модерировать нечего). Рекомендация моделей: сначала общая схема + запуск app, админку — по триггеру объёма; на старте модерация может жить на дефолтном Refine/Supabase-дашборде.
**Но:** off-the-shelf reframe (Directus/Retool) от CEO-лензы **не применяю** — владелец уже отклонил Directus и зафиксировал Refine+shadcn (контекст, которого у лензы не было). Остаётся к решению только **тайминг** (см. `questions.md` A1–A2).

## Ревизия этапов (с учётом ревью)

0. **Схема-first + auth-каркас** — общая Prisma-схема (Report/Ban/AdminUser/ModeratorAction/media-meta), тонкий admin-API (Next Route Handlers), отдельный admin-auth + 2FA, mock-провайдер, `.env.example`+README. Критерий: логин на моках.
1. **Очередь жалоб (ядро)** — двухпанельный triage, клавиатура, бан (confirm+причина+срок), аудит-запись, состояния (loading/empty/error/optimistic-rollback).
2. **Пользователи + Bulk + Audit-log** — таблица (денорм. счётчик, cursor, виртуализация), мультивыбор, экран журнала действий.
3. **Медиа-ревью (safe)** — галерея blur-by-default + lightbox/vidstack, CSAM-эскалация, proxy R2, «медиа удалено».
4. **Обзор + Баны + полиш** — стат-карты, список банов (active/expired), анимации (по правилам выше), финальная приёмка a11y/375–1440.

СТАТУС: **DONE_WITH_CONCERNS** — план отревьюен и ужесточён; блокеры (тайминг/приватность/юр) требуют ответов владельца в `questions.md` до кода.
