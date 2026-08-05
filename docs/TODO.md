# Anoon — TODO

Статус и архитектура: [PROJECT-STATUS.md](PROJECT-STATUS.md). Фичи: FEATURES-USER/ADMIN.

## Готово ✅
- Фронт `frontend`: все экраны (мессенджер + рулетка), PWA, медиа-вьювер, реальный шелл `/anoon`, typecheck 0.
- Сервер `server-stack`: self-hosted Tinode из исходника (v0.25.2), работает на :6061 / gRPC :16061.
- Переименование anoon → anoon (код + доки). Чистка шаблонного мусора.
- **Патч анонимности (вариант E)**: `topic.go`, флаг `aux["anon"]`, образ пересобран (`server-stack/ANON-PATCH.md`).
- **Companion (Go)**: каркас, БД `anoon`, ROOT gRPC-бот, `#ID`-счётчик (A2); auth — `rest`-endpoint + Google OAuth + email/basic (A3), тесты зелёные.
- **Фронт↔сервер**: реальный вход (basic под флагом `NEXT_PUBLIC_USE_TINODE`), список чатов из `me`-топика, живой 1:1 (send/receive/«печатает»), моки при выкл. (`frontend/TINODE-INTEGRATION.md`).
- **Планы**: `PAYMENTS-PLAN.md` (оплаты D2), `DEPLOY-PLAN.md` (Hetzner E2), `ADMIN-REUSE-PLAN.md` (админка reuse).

## Дальше ⬜
1. **Рулетка-мэтчинг** в companion (C2): очередь по полу/возрасту + приоритет платных → создание анон-топика (`aux anon=true`, **без бита `P`**) → событие «нашёлся» на фронт. *(начато, не дописано)*
2. **Фронт**: реальная рулётка/анон-чат через Tinode, раскрытие→друзья, профиль+#ID из companion. Убрать оставшиеся моки.
3. **Модерация** (жалобы/бан/мьют) + подключить админку (`admin`) к companion-API.
4. **Оплаты** (D2, по `PAYMENTS-PLAN.md`) + **пуши** (VAPID/FCM) + **прод-деплой** (по `DEPLOY-PLAN.md`).
5. Follow-up: `.conf` rest-auth блок для Google (нужен `GOOGLE_CLIENT_ID`); форма входа для возвращающихся; dev-вход «чат по #ID».
6. Мелочь фронта: реакции в Личке проверить визуально, `⋯` в фуллскрин-вьювере, «a/» лейблы вкладок.

## Отложено
См. [BACKLOG.md](BACKLOG.md).
