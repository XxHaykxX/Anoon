/**
 * Веб-половина `push.ts`.
 *
 * Веб-сборка мобильного клиента существует только как смоук-тест
 * (`expo export --platform web`) — продуктовый веб живёт в `frontend/` и имеет
 * собственные Web Push через VAPID. Здесь важно ровно одно: не тащить в браузер
 * `expo-notifications`.
 *
 * Почему отдельный файл, а не проверка `Platform.OS` внутри `push.ts`: модуль
 * зовёт `Notifications.useLastNotificationResponse()` на верхнем уровне хука, а
 * этот вызов на вебе бросает «ExpoNotifications.getLastNotificationResponse is
 * not available on web». Исключение прилетало из корневого `_layout.tsx`, то
 * есть роняло всё дерево — в собранном бандле это выглядело как `React #418` на
 * каждом экране и делало веб-экспорт бесполезным как проверку. Обернуть вызов
 * условием нельзя: хук нельзя звать по условию. Тот же приём уже применён для
 * `react-native-webrtc` (`webrtc.web.ts`).
 */

export type PushStatus = {
  enabled: boolean;
  reason: string | null;
};

/** На вебе уведомлениями заведует сам браузер, а не приложение. */
const WEB_REASON = 'Веб-версия включает уведомления в настройках браузера';

export async function pushStatus(): Promise<PushStatus> {
  return { enabled: false, reason: WEB_REASON };
}

/** Тумблер на вебе выключен и говорит почему — включать нечего. */
export async function enablePush(): Promise<PushStatus> {
  return { enabled: false, reason: WEB_REASON };
}

export async function disablePush(): Promise<void> {
  /* нечего выключать */
}

export async function syncPushRegistration(): Promise<void> {
  /* токен на вебе не выдаётся, регистрировать нечего */
}

/** Нажатий на уведомление в браузере не будет — маршрутизировать нечего. */
export function usePush(): void {
  /* no-op */
}
