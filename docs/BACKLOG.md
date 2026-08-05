# Anoon — Backlog (features from reference design, deferred)

Features seen in the reference design images that are NOT built now. Kept here to pick up later.
Each notes: where it belongs, effort, and whether it needs backend beyond stock Tinode.

## Deferred (functional / heavy / not in core clone screens)

### 1. Saved Messages / Bookmarks
- **What:** bookmark icon in the chats top bar → a personal "saved messages" topic.
- **Why deferred:** functional feature, needs a self-topic message store + UI flow. In the clone the bookmark icon is shown but not wired.
- **Effort:** MEDIUM (client). Tinode: can reuse the user's `me`/self topic — no server change.
- **Port to Anoon:** feasible, client-only.

### 2. Onboarding / splash carousel ("Start Messaging", paged dots)
- **What:** first-run swipeable intro slides + CTA.
- **Why deferred:** separate flow, not part of the chat screens.
- **Effort:** LOW (client, pure UI).
- **Port to Anoon:** feasible, client-only.

### 3. In-chat music / audio player (now-playing bar, track list, scrubber, playback speed)
- **What:** the desktop reference screen shows a music player with track list, progress, play/pause.
- **Why deferred:** rich media widget; desktop screen not in the current mobile clone scope.
- **Effort:** MEDIUM-HIGH (client).
- **Port to Anoon:** feasible client-only; Tinode already plays voice — extend to audio attachments.

### 4. Настоящая десктоп-версия anoon
- **Что:** резиновый десктоп-макет anoon (две панели: список рулётки/друзей слева + чат справа, как Telegram Desktop). Сейчас есть только вкладка «Desktop» в витрине = **старый мокап мессенджера** (`src/components/screens/DesktopScreen.tsx`, боты/каналы/звонки), не anoon, не подключён.
- **Почему отложено:** решение 2026-07-03 — **мобайл-first** (PWA-запуск в Армении, почти весь трафик с телефонов). Десктоп — позже, когда мобайл обкатан.
- **Объём:** HIGH (client) — каждому anoon-экрану нужен широкий макет.
- **Не удалять:** легаси `screens/*` и вкладку «Desktop» оставляем (по решению пользователя).

## Notes
- Everything above is client-only — no new backend beyond stock Tinode.
- The architectural NO/NEEDS-FORK items (anonymous matchmaking, true anonymity, cross-device view-once) live in the separate FEATURES-USER.md analysis, not here.
- Built now instead (in the clone): bottom tab nav, contact filter pills, alphabetical index, per-row quick chat/call icons, rich file-transfer card, missed-call card, Username + Bio fields, Data & Storage settings row.
