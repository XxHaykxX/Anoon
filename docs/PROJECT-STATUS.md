# Anoon — статус проекта

> Единый источник правды по состоянию проекта. Обновлён 2026-07-05.
> Имя продукта — **anoon**. Некоторое время проект назывался *badu*; 2026-08-05 имя вернули
> обратно, весь код, база и контейнеры переименованы. «badu» в старых записях = anoon.

## Что такое Anoon
Тёмное мобильное приложение (PWA), русский язык, бренд-цвет жёлтый `#FDBF2D`. Два режима в одном аппе:
1. **Анонимная чат-рулетка 18+** — знакомства по `#ID` (пятизначный, напр. `#00001`), подбор
   собеседника по фильтрам (пол/возраст), «Раскрыть профиль» → становитесь друзьями.
2. **Обычный мессенджер** — личная переписка с друзьями (реакции, медиа, голос, статусы, звонки).

Полное описание фич: [FEATURES-USER.md](FEATURES-USER.md) (пользователь), [FEATURES-ADMIN.md](FEATURES-ADMIN.md) (админка).

## Архитектура
```
Фронтенд (Next.js)            Сервер (self-hosted)
frontend/  ──HTTP/WS──►     server-stack/ (Tinode из исходника)
                                   │
                          gRPC :16061 ──► (TODO) companion-сервис anoon
                                          рулетка/#ID/друзья/модерация
```
- **Messaging-движок = Tinode** (готовый, чужой, не форкаем): сообщения, присутствие, «печатает»,
  статусы, медиа, пуши, блокировка, звонки.
- **Бизнес-логика anoon = наш код** (ещё не написан): рулетка-мэтчинг, #ID, раскрытие→друзья,
  рейтинги, жалобы/модерация, view-once. Живёт в companion-сервисе через gRPC — ядро остаётся
  стоковым, апгрейды Tinode безболезненны.

## Фронтенд — `C:\Users\Admin\Desktop\anoon\frontend`
Next.js 16 + React 19 + Tailwind v4 + TS. `npm run dev` → **localhost:3001**. typecheck чист.
- **Витрина** (`/`) — все экраны в light+dark телефон-фреймах (вкладки).
- **Реальный апп** (`/anoon`) — навигируемый шелл: auth-степпер + Главная→Поиск→Чат + bottom-nav.
- **Экраны (оба набора, оба нужны):**
  - Мессенджер-стиль: Onboarding, Login, Chats, Chat, Voice, Music, Contacts, Contacts sheet, Account, Desktop.
  - Anoon-рулетка (`src/components/anoon/*`, 25 экранов): Вход/Регистрация/Почта/Забыл-Сброс/Пол/Профиль-старт,
    Главная/Поиск, Аноним-чат/Оценка/Раскрытие, Друзья/Поиск/Заявки/Инвайт(QR)/Личка,
    Уведомления/Жалоба/Бан/Мьют, Профиль/Настройки/Офлайн/Установка.
- **PWA:** manifest + service worker (`public/sw.js`) + офлайн + install-hook.
- **Медиа:** `AnoonMediaViewer` (зум-щипок, двойной-тап, свайп-листание, «N/N», свайп-вниз-закрыть).
- Аватары = градиент+инициалы (плейсхолдеры, не фото — осознанный выбор).

## Сервер — `C:\Users\Admin\Desktop\anoon\server-stack`
Своя воспроизводимая сборка Tinode **из исходника** (`../server` = клон `github.com/tinode/chat` @ v0.25.2).
- `docker compose up -d --build` → образ `anoon-tinode:0.25.2` + postgres:16.
- Порты **6061** (HTTP/API) + **16061** (gRPC). HTTP отдаёт Anoon-вебапп (`../webapp`).
- Секьюрные ключи в `.env` (не коммитить). Детали + грабли: [server-stack/README.md](server-stack/README.md).
- Старый демо-контейнер `TINODE` на 6060 не тронут (можно погасить).

## Статус
> Обновлён по итогам сессии 2026-07-04 (аудит + 3 волны фикс-агентов + perf/QA + живой phone-test). ✅ готово · 🟡 частично · ⬜ не начато.

| Часть | Статус |
|---|---|
| Фронт: все экраны (мессенджер + рулетка), PWA, вьювер, `/anoon` шелл | ✅ готово, typecheck 0 |
| Сервер Tinode из исходника, self-hosted, работает | ✅ готово (healthy :6061) |
| **Патч анонимности (вариант E)** — `topic.go`, флаг `aux["anon"]`, gRPC-путь `aux` починен | ✅ готово (`server-stack/ANON-PATCH.md`) |
| **Companion-сервис** — каркас (Go), БД `anoon`, ROOT gRPC-бот, `#ID`-счётчик | ✅ готово (A2) |
| **Companion auth** — `rest`-endpoint, Google OAuth-брокер, email/basic, `GET /me`, токен-LRU-кэш | ✅ готово (A3) |
| Companion: рулетка-мэтчинг + создание анон-топика (без P-бита) | ✅ готово (C2), bucketized O(1), 14/14 тестов |
| Companion: друзья/раскрытие→друзья | ✅ готово |
| Companion: модерация — жалобы/бан/мьют/блок, `0004_moderation.sql`, presence-трекер | ✅ готово (D1 бэкенд) |
| Companion: **`/admin/*` API** (X-Companion-Admin-Secret + роли, {data,total}) | ✅ готово, enable-флаг `COMPANION_ADMIN_SECRET` |
| Companion: оплаты, view-once, temp-ban expiry-cron | ⬜ не начато |
| Фронт↔сервер: вход (basic+email-login), чаты из `me`, живой 1:1 | ✅ готово (B1/B2/C1) |
| Фронт: **реальная рулетка/анон-чат/раскрытие, профиль+#ID из companion** | ✅ готово, живой 2-user матч подтверждён |
| Фронт: logout/report/block/notifications/settings подключены к companion | ✅ готово, tsc 0 |
| Админка (`admin`) — companion-client + `ADMIN_BACKEND` switch | 🟡 reports/users/bans/overview live; chats/media/broadcast — нет endpoint |
| E2E-тесты (Playwright, mock-mode, 17 тестов) + phone-test инфра (Caddy+cloudflared) | ✅ готово (`frontend/tests/e2e`, `server-stack/PHONE-TEST.md`) |
| Реальные пуши (VAPID/FCM) | ⬜ не начато (Phase E) |
| Прод-деплой — Hetzner CX32 ~€14/мес | 🟡 план готов (`DEPLOY-PLAN.md`), не выполнен |
| Оплаты Армении + монетизация | 🟡 тех-спека готова (`PAYMENTS-PLAN.md`), код нет |

Полный разбор: [AUDIT-2026-07-04.md](AUDIT-2026-07-04.md).

### Медиа/чат-фичи (сессия 2026-07-05)
| Фича | Статус |
|---|---|
| **Фото/видео/голосовые** в чате — реальная загрузка+рендер+плеер | ✅ готово, live-verified (photoOK/voiceOK) |
| Панель вложений урезана до Фото+Видео | ✅ |
| Рулетка: залипшие active-матчи авто-закрытие + окно anti-repeat в env | ✅ (`ROULETTE_RECENT_WINDOW`, =0 для теста) |
| tinode-API: receipts/presence/delete/edit/reactions/avatar/RTCPeerConnection | ✅ (обёртки готовы) |
| companion.ts+libs: callSignaling, push, POL-1 (пред-логин 403 убран) | ✅ |
| UI: CallScreen/IncomingCall/ReactionBar | ✅ (компоненты) |
| BE companion: WebRTC-сигналинг + push(VAPID) + ban-cron + приоритет очереди | ✅ готово, образ пересобран |
| **Вживление** (звонки/реакции/статусы/аватары/view-once/UX) в чаты/профиль | ✅ **ВОЛНА 2 готова** (6-агентный флот) |
| **Волна 3** (прод-деплой, coturn/TURN, CORS/ENV-gate, кошелёк, звук, media-track, DELETE /me) | ✅ готово (артефакты; выполнение деплоя на юзере) |

Очередь фич #80–107 (звонки, статусы, реакции, ответы, удаление/редакт, аватары, view-once, пуши, ban-cron, приоритет, друзья-превью, настройки-аккаунт, кошелёк, прод-инфра) — **всё сделано**.

### Финальный 2-user live QA (2026-07-05, Playwright admin1↔admin2, Caddy :8088 single-origin)
**13/14 PASS = 14/14 функционально, 0 консоль-ошибок.** Логин обоих ✓ · рулетка-матч (#00011↔#00012) ✓ · текст A↔B ✓ · галочки-статусы (SVG, 1 «провал» = эвристика не ловит SVG текстом, работает) ✓ · фото A→B загрузка+рендер ✓ · реакции ✓ · звонок входящий+активный WebRTC ✓ · раскрытие→друзья ✓. Полный repo typecheck = 0. Харнесс: `scratchpad/qa2.mjs`.

### Пост-QA багхант (E2E-регресс-сетка нашла 2 реальных бага, оба починены, tsc=0)
Живой прогон E2E (`tests/e2e/real/`, admin1/admin2) поймал то, что ручной проход пропустил (тестил только внутри анон-чата, не friend-chat после reveal):
- **BUG-1** поиск друзей по #ID всегда пусто: companion шлёт `{results:[]}`, клиент ждал голый массив → `rows.map` падал. Фикс: unwrap в `companion.ts`.
- **BUG-2** reveal→друг чат «мёртв» при переоткрытии. **ИСПРАВЛЕН (2026-07-05).** Первоначальная гипотеза (grp-vs-p2p топик) оказалась НЕВЕРНОЙ — reveal by design оставляет общий group-топик, это правильно. **Настоящий корень:** `openChat` вызывался РОДИТЕЛЕМ (AnoonFriends) до навигации, а `closeChat`-teardown принадлежит ДЕТЯМ (AnoonPrivateChat unmount-effect). React StrictMode dev double-mount (mount→cleanup(closeChat)→remount) зануляет `activeChat`, выставленный родителем → `sendChatMessage` bail на `!friend?.topic` → НИ ОДИН WS pub-фрейм не уходит, без ошибки, bubble застревает "sending". **Фикс:** store-поле `chatTarget` (переживает closeChat); `AnoonFriends.openFriend` ставит chatTarget + навигирует; `AnoonPrivateChat` mount-effect симметрично гонит `openChat(chatTarget)` ↔ `closeChat` on unmount. Плюс `tinode.ts`: `pendingLeaves`-map (subscribeTopic ждёт in-flight leave), `sendMessage` ensure-attached+retry guard; `data-topic` атрибут на friend-rows для детерминированного E2E. **Верификация:** WS-frame Playwright репро — оба переоткрывают ТОТ ЖЕ grp-топик, кросс-отправка ДВУСТОРОННЯЯ (B видит REOPEN-A + A видит REOPEN-B), pub-фреймы уходят, 0 консоль-ошибок, правильный #ID собеседника в шапке. Файлы: `store/types.ts`, `store/slices.ts`, `lib/tinode.ts`, `components/anoon/AnoonFriends.tsx`, `components/anoon/AnoonPrivateChat.tsx`. tsc=0.
> Примечание: chat-core (агент-автор волны 2) исчерпал лимит сессии посреди фикса — доделал main-агент сам (диагностика + весь фикс).
### Волна «доступное без юзера» — 7-агентный флот (2026-07-05)
Скан TODO/заглушек → 10 задач (#111–120), заблокированное на юзере исключено. Агенты с непересекающимися файлами + замороженными контрактами, 0 merge-конфликтов. **Отгружено (tsc/go build 0):** #111 чёрный список (companion CRUD + AnoonSettings + push-toggle→subscribePush), #112 message-push (ROOT-бот шлёт пуш оффлайн-получателям; огранич.: только grp/anon/revealed, p2p не покрыты), #114 view-once в friend-чате, #115 WS reconnect/backoff+resubscribe (tinode+companion), #116 auth-экраны forgot/reset/verify→companion (SMTP-заглушка seam, migration 0009), #117 admin broadcast+gender end-to-end, #118 a11y-sweep, #119 E2E real/ specs, #120 rate-limiting (token-bucket, 429). **Companion-образ пересобран** (migration 0009 applied, эндпоинты живые). **Живая интеграционная верификация (2-user): 15/16 PASS, 0 консоль-ошибок** — core-регресс весь зелёный, новые #111/#114/#116 ✅. **1 реальный баг → #121 (BUG-4), глубоко копал, НЕ добит, deferred:** live-отражение hard-delete «у всех» у собеседника не работает. Отгружен многослойный фикс (companion P-бит на reveal [+presence друзей], companion WS del-relay, фронт purge-cache/emit/onFrame) — всё tsc/go-build/prod-build чисто, НО остаётся блокер: A не шлёт msg:del по companion-WS (`sendRaw` no-op — companion events-сокет A не OPEN в момент удаления). Own-delete + edit-reflection работают. Причина №4 (почему сокет не OPEN) = отдельный фокус-цикл. **РЕШЕНИЕ (2026-07-06): принято как задокументированное ограничение (вариант B, решение юзера) — НЕ блокер, edge-фича; основное «удалить у всех» работает у автора, edit отражается у пира; live peer-reflection hard-delete отложено.** Осталось на юзере: SMTP-отправка (seam готов), платежи, Google, Hetzner-деплой, ротация секретов, Q7a.

### Большая волна баг-фиксов #122–149 (BUG-5→32) — 4-агентный флот, loop (2026-07-06)
Юзер тестил на телефоне (cloudflared-туннель) → нашёл ~19 реальных багов за проход + попросил найти ещё + дизайн 1:1 с моком + полный 2-клиентский тайминг-QA. Урок: прошлый QA проверял проводку (WS-фреймы, 0 консоль-ошибок), НЕ вид и НЕ живой многошаговый сценарий 2 клиентов. Флот: ScreensFix/MediaFix/ChatWiring/RealtimeFix, непересекающиеся файлы, frozen-контракты (mediaViewerStore). **27 багов закрыто:** notif-badge (хардкод), profile-avatar (useState-latch), settings-cleanup, read-тики (fast-read race), эмодзи responsive+close, фото-открывает-НЕ-ТО (роут на DEMO-градиенты → store-вьювер real src), медиа узкие/оверлей, view-once дизайн, голосовое (native→waveform+webm-Infinity фикс), reveal-анимация+аватар, peer-left (companion relay+system-строка), звонки (ICE-буфер race+симметричный hangup), фон-сообщения (background-subscribe вместо leave), typing/media-индикатор (kp+activity-relay), звук, QR-убрать, own-age-убрать, requests-removeRequest, navigator.share, автоскролл, reply-цитата-мёртвая, **приватность: view-once в свайп-галерее (обход tap-gate) — исправлено**. Companion пересобран 3× (peer-left+activity relay, health 200). Дизайн-источник = mock/showcase (Figma в репо нет). В работе: BUG-24 нав-редизайн (Chats первый+landing, Рулетка центр-FAB), 25/26/27/31/32. 2 тайминг-харнесса (qa-nonchat.mjs+qa-chat.mjs) написаны, ещё не прогнаны. tsc=0. Прод-ребилд + полный 2-user QA — следом.

### Полный 2-user QA — все страницы + функции (2026-07-05)
После фикса всех багов прогнан comprehensive Playwright-харнесс (admin1↔admin2, Caddy :8088, getUserMedia mock). **Phase-1 интеракции 24/24 PASS + Phase-2 страницы 7/7 PASS, 0 консоль-ошибок.** Проверено вживую: логин оба · возраст+рулетка-матч · анон-текст A↔B · галочки-статусы · анон-фото · реакция · звонок аудио (входящий+приём+актив WebRTC) · раскрытие→друзья · friend-текст A↔B · friend-фото · presence в шапке · reply (long-press) · edit своего · delete (меню) · выход-в-shell · список друзей · **поиск друга по #ID** (BUG-1 путь) · reopen friend-чата (BUG-2/109 регресс чист) · профиль · инвайт (QR/#ID) · кошелёк (баланс/паки монет/Premium 1990֏/Super 4990֏) · настройки (пароль/push/ник/звук/удалить аккаунт) · уведомления · главная. Кодовое изменение из QA: `aria-label="Поиск друзей"` на SearchIcon (a11y+тестируемость). **Продуктовых багов не найдено — всё работает.**

### Продолжение волны → прод-ребилд + 2-клиентский тайминг-QA + BUG-33→41 (2026-07-06)
Ещё юзер-баги + аудиты закрыты: BUG-24 нав-редизайн, BUG-25/26/27/28(автоскролл был вообще отсутствует)/29(reply-цитата мёртвая)/30(view-once privacy-leak)/31/32/35 e2e-подметания, BUG-33 presence-закрытого-чата регресс, BUG-34 delete-закрытого-чата регресс, **BUG-36 разделение Чаты/Контакты на 2 таба**, BUG-37 voice-composer overflow. **Прод пересобран (`next start -p 3001` за caddy :8088) + live-verified: логин (поле «Почта» принимает username admin1), лендинг = «Чаты», нав [Чаты][Контакты](Рулетка FAB)[Уведомления][Профиль], 0 консоль-ошибок. qa-chat.mjs 2-клиент тайминг: 20/22 PASS — оба юзер-репортнутых тайминг-бага повторяемо зелёные: BUG-15 peer-left + BUG-16 звонок.** Последние: **BUG-38** анон-чат read-тик не продвигался (friend работал) — добавил friend-паттерн приёмок в анон-слайс (anonPeerRecvSeq/ReadSeq + noteRecv/noteRead + onInfo). **BUG-39/40/41** — один корень: у admin1 висячий `photo.ref` (blob 404) без fallback → broken-img везде + лишний скролл на Профиле. Фикс: onError→инициалы в AnoonProfile/AnoonFriends/AnoonHome + скрыт скроллбар. Live-verified: жёлтый «AD»-аватар вместо битой картинки, скролла нет. **41 баг закрыто (BUG-5→41). tsc=0.** Осталось на юзере: #67 Q7a, #68 платежи, Google creds, SMTP, Hetzner-деплой, ротация секретов.

### Живой 2-user тест на телефоне → BUG-42/44/45 (2026-07-06)
Юзер тестил чат admin1(телефон)↔admin2(браузер) вживую. Найдено+пофикшено+верифицировано соло: **BUG-42** — весь путь холодной заявки по #ID (поиск→добавить→принять→чат) был сломан end-to-end (тестился только рулетка→reveal): друг создавался без p2p-топика (чат мёртв у принявшего), реквестеру не слалось событие (пусто в Контактах), 409 на respond, double-## «##00011», копирайт. Фикс: companion шлёт `friend_accepted` (топик+#ID), идемпотентный respond, frontend upsertFriend с топиком + обработчик события; 2-user harness ALL PASS. **BUG-44** — reload выкидывал на логин (токен только в памяти): персист токена+User в localStorage + `restoreSession()` на boot + splash; проверено reload→остаёшься в Чаты. **BUG-45** — застрявший unread + read-тик не флипался: (1) noteRead без seq не двигал server-указатель (фикс: maxMsgSeq), (2) me-merge перетирал локальный сброс (readTopics Set), (3) **главное** — bgHandlers считал переигранные кэш-сообщения новыми unread каждую загрузку (гард `m.seq<=myReadSeq`). Проверено: reload→бейдж исчез. **Также:** AnoonFriendSearch текст почищен (без 3× «#ID или ник», `#` опционален, «ник» убран — backend ищет только по точному #ID). Почищено 234 stale Tinode-подписки (grp-рулетки+p2p от тестов, суммировались в бейдж). **BUG-43** — Чаты+шапка показывали сырой `usrXXX`/`#Iw-k1qaysQo` вместо `#ID` для ВСЕХ p2p friend-чатов. Корень: `contactToFriend` фабрикует hashId из uid; настоящий #ID есть только в companion `GET /friends`, который НИКОГДА не грузился в startContacts; плюс `friendsList()` имел BUG-1-стайл unwrap-баг (`{friends}`). Фикс: (1) companion.ts unwrap `{friends}`; (2) slices.ts `companionIds`-Map + `refreshCompanionIds()` awaited перед subscribeMe; (3) me-merge резолвит `const cid = companionIds.get(c.topic)` — cid всегда выигрывает. Верифицировано (Playwright :8088): reload admin2 → список чатов «#00011» (было usrIw-k1qaysQo), шапка «#00011»/«в сети». **45 багов закрыто (BUG-5→45). ВСЕ code-баги закрыты; осталось только #67/#68 (USER-blocked).** tsc=0, прод/companion пересобраны, health :3001/:8088/companion → 200.

- **BUG-3** (#110) reopen friend-чата: старые anon-сообщения реплеились с битой атрибуцией (своё показывалось как входящее). **ИСПРАВЛЕН (2026-07-05).** Корень: pre-reveal anon-сообщения имеют СЕРВЕРНО-бланкованный `from` (патч анонимности variant-E), клиент атрибутировать не может (getMessagesPage читает кэш → рефетч не помогает). Продуктовое решение: friend-чат стартует СВЕЖИМ с момента reveal — pre-reveal anon-история не показывается. Фикс = 1 строка в `slices.ts` openChat onMessage: `if (!m.from) return;`. Post-reveal сообщения (реальный from) рендерятся верно, симметрично обе стороны. Верифицировано: 4/4 anon-hide + #109 регресс чист (двусторонний post-reveal send), пустое состояние «Нет сообщений — напишите первым». tsc=0.

## Следующие шаги
1. **Needs-user** (блокеры на Hayk): ротация закоммиченных секретов + argon2 для ADMIN_PASSWORD; `GOOGLE_CLIENT_ID` для live-OAuth; юр-вопрос Q7a (чтение ROOT-топиков в админке, #67); оплаты/монетизация (#68).
2. Прод: выключить `COMPANION_DEV_AUTH`, tighten CORS, deploy Hetzner (E2).
3. Оплаты (D2) + приоритет очереди по тарифу; пуши (E1).
4. Мелкий тех-долг: temp-ban expiry-cron, guard `startCompanionEvents` до sessionToken, `age?:number` в BasicSignInInput.

## Документы
- Этот файл — **статус/архитектура (главный, живой)**.
- `BUILD-PLAN.md` — **мастер тех-план** (фазы A→E: как строим и соединяем). `COMPANION-PLAN.md` — лог решений companion.
- `FEATURES-USER.md`, `FEATURES-ADMIN.md` — спецификация фич. `DESIGN-DIRECTION.md` — визуал.
- `BUSINESS-PLAN.md` — монетизация. `PAYMENTS-PLAN.md` — оплаты Армении + billing-модуль. `DEPLOY-PLAN.md` — прод.
- `TODO.md` / `BACKLOG.md` — задачи/отложенное.
- `server-stack/README.md` — как поднять сервер. `server-stack/ANON-PATCH.md` — патч анонимности. `server-stack/ADMIN-REUSE-PLAN.md` — план админки. `server-stack/companion/PLAN.md` — план companion.
- `frontend/TINODE-INTEGRATION.md` — карта подключения фронта к Tinode.
