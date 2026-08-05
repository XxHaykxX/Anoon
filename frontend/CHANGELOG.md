# Changelog — Anoon frontend

Формат [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), версии [SemVer](https://semver.org/).

## [Unreleased]
### Added
- Экраны anoon-рулетки (`src/components/anoon/`, 25 шт.): auth-флоу, Главная/Поиск, Аноним-чат/Оценка/Раскрытие,
  Друзья/Поиск/Заявки/Инвайт(QR)/Личка, Уведомления/Жалоба/Бан/Мьют, Профиль/Настройки/Офлайн/Установка.
- Реальный навигируемый апп на `/anoon` (`AnoonApp` + `anoonNav`): auth-степпер, Главная→Поиск→Чат, bottom-nav.
- PWA: `manifest.webmanifest`, service worker (`public/sw.js`), офлайн-страница, install-hook.
- `AnoonMediaViewer` — полноэкранный просмотр медиа (зум-щипок, двойной-тап, свайп-листание, «N/N», свайп-вниз-закрыть).
- Голосовой экран (`VoiceChatScreen`), `MediaBubble` (блюр+прогресс+view-once).

### Changed
- Переименован **anoon → anoon** во всех экранах, идентификаторах, роутах и документах.
- Chat приведён 1:1 к референсу (медиа-бабблы, кнопки файлов, бейджи, голосовые).
- Contacts: рабочие фильтр-чипы. Desktop: тред синхронен с выбранным чатом. Оживлены мёртвые кнопки (эмодзи/язык/сорт/камера).

### Removed
- Шаблонный мусор клонера (agent-rule папки, clone-website скиллы, boilerplate).
