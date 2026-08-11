import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { removePushSubscription, savePushSubscription } from '@/lib/companion';
import { platform } from '@/lib/platform';
import { useAnoonStore } from '@/store';

/**
 * Пуши на телефоне (#17). Это НАТИВНАЯ половина `frontend/src/lib/push.ts`:
 * файл называется так же и по алиасу `@/lib/push` перекрывает веб-версию для
 * кода мобилки (в `tsconfig.json` путь `./src/*` стоит перед `../frontend/src/*`).
 * Веб продолжает подписываться через Service Worker + VAPID, телефон — через
 * Expo Push, а решение «кого будить» одно на двоих и живёт на бэкенде
 * (`companion/internal/api/expopush.go`).
 *
 * Хранилище подписок у бэкенда тоже одно: токен уезжает как обычный endpoint с
 * префиксом `expo:` — отсюда и `savePushSubscription`/`removePushSubscription`
 * из общего клиента вместо отдельного метода.
 *
 * Чего здесь нет и почему: локальных уведомлений о сообщении, пришедшем при
 * открытом приложении. Экран и так его показывает, а бэкенд в этом случае пуш
 * не шлёт вовсе (у получателя живой сокет).
 */

/** Токен на бэкенде выглядит как endpoint — та же строка, что понимает Go. */
const EXPO_ENDPOINT_PREFIX = 'expo:';

/** Пользовательский тумблер. Тот же ключ, что у веба, но своё хранилище. */
const PUSH_PREF_KEY = 'anoon:notify:push';

/** Последний зарегистрированный токен — чтобы было что отзывать при выключении. */
const PUSH_TOKEN_KEY = 'anoon:notify:push-token';

/**
 * Состояние тумблера. `reason` заполнен ТОЛЬКО когда пуши выключены не по воле
 * пользователя: молчаливый отказ («тумблер щёлкнул и ничего не произошло») —
 * это то, ради чего экран уведомлений вообще показывает причину.
 */
export type PushStatus = {
  enabled: boolean;
  reason: string | null;
};

/** Приложение в Expo Go: пуш-креды туда не выдаются, токен бесполезен. */
function inExpoGo(): boolean {
  return Constants.expoGoConfig != null;
}

/**
 * `projectId` из EAS. Без него `getExpoPushTokenAsync` не может назвать проект,
 * которому принадлежит устройство, и падает — а мы обязаны показать причину, а
 * не пустой тумблер.
 */
function easProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromExtra ?? Constants.easConfig?.projectId ?? null;
}

/** Показывать баннер, даже когда приложение открыто (иначе пуш просто исчезает). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Канал Android. Обязателен: без него система кладёт уведомления в безымянный
 * канал по умолчанию с низкой важностью, и на заблокированном экране их не
 * видно. Имя канала совпадает с `channelId`, который шлёт бэкенд.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Сообщения',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#FDBF2D',
    vibrationPattern: [0, 250, 250, 250],
  });
}

/** Сохранённый выбор пользователя. По умолчанию (ключа нет) — «ещё не спрашивали». */
function storedPref(): '1' | '0' | null {
  const v = platform().storage.get(PUSH_PREF_KEY);
  return v === '1' || v === '0' ? v : null;
}

/**
 * Почему пуши невозможны на этой сборке — до всяких системных запросов.
 * `null` означает «препятствий нет».
 */
function hardBlocker(): string | null {
  if (Platform.OS === 'web') return 'Веб-версия включает уведомления в настройках браузера';
  if (inExpoGo()) {
    return 'В Expo Go пуши не приходят — нужна сборка приложения (EAS Build)';
  }
  if (!easProjectId()) {
    return 'Проект не привязан к EAS: в app.json нет extra.eas.projectId';
  }
  return null;
}

/**
 * Текущее состояние без единого системного диалога — то, что рисует экран при
 * открытии. Разрешение только читается (`getPermissionsAsync`), не запрашивается.
 */
export async function pushStatus(): Promise<PushStatus> {
  const blocked = hardBlocker();
  if (blocked) return { enabled: false, reason: blocked };
  if (storedPref() === '0') return { enabled: false, reason: null };

  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      return {
        enabled: false,
        // Первый заход — это не отказ: спросить ещё не успели.
        reason: perm.canAskAgain ? null : 'Уведомления запрещены в настройках телефона',
      };
    }
  } catch {
    return { enabled: false, reason: 'Уведомления недоступны на этом устройстве' };
  }
  return { enabled: platform().storage.get(PUSH_TOKEN_KEY) != null, reason: null };
}

/**
 * Включить пуши: спросить разрешение (на Android 13+ и на iOS это системный
 * диалог), получить токен сборки и отдать его companion. Ничего не бросает —
 * любой отказ возвращается видимой причиной.
 */
export async function enablePush(): Promise<PushStatus> {
  const blocked = hardBlocker();
  if (blocked) return { enabled: false, reason: blocked };

  try {
    await ensureAndroidChannel();

    // На Android 13+ POST_NOTIFICATIONS выдаётся только по явному запросу; на
    // iOS без него не будет ни баннера, ни звука. Заявлено в app.json, но
    // объявление разрешения и его получение — разные вещи.
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await Notifications.requestPermissionsAsync();
    }
    if (!perm.granted) {
      platform().storage.set(PUSH_PREF_KEY, '0');
      return { enabled: false, reason: 'Уведомления запрещены в настройках телефона' };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: easProjectId() ?? undefined,
    });
    await savePushSubscription(expoSubscription(token));

    platform().storage.set(PUSH_PREF_KEY, '1');
    platform().storage.set(PUSH_TOKEN_KEY, token);
    return { enabled: true, reason: null };
  } catch {
    // Сеть, отсутствующие push-креды сборки, отозванный ключ — снаружи всё это
    // одно и то же: токена нет. Тумблер обязан остаться выключенным.
    return {
      enabled: false,
      reason: 'Не удалось получить токен устройства — проверьте связь и креды сборки',
    };
  }
}

/**
 * Выключить пуши: снять регистрацию на бэкенде. Системное разрешение НЕ
 * отзывается — его отдал пользователь, и забирать его за него нечестно, а
 * вернуть можно только походом в настройки телефона.
 */
export async function disablePush(): Promise<void> {
  platform().storage.set(PUSH_PREF_KEY, '0');
  const token = platform().storage.get(PUSH_TOKEN_KEY);
  platform().storage.remove(PUSH_TOKEN_KEY);
  if (!token) return;
  try {
    await removePushSubscription(EXPO_ENDPOINT_PREFIX + token);
  } catch {
    /* бэкенд недоступен — строка протухнет сама, когда Expo вернёт DeviceNotRegistered */
  }
}

/**
 * Подписка в том виде, в каком её принимает companion: токен и есть endpoint, он
 * же обе «ключевые» строки — так строка в `push_subscriptions` требует владения
 * токеном ровно так же, как браузерная требует владения ключами.
 */
function expoSubscription(token: string): PushSubscriptionJSON {
  return {
    endpoint: EXPO_ENDPOINT_PREFIX + token,
    keys: { p256dh: token, auth: token },
  };
}

/**
 * Привести регистрацию в соответствие с выбором пользователя — вызывается после
 * входа. Первый вход показывает системный диалог (иначе пуши на телефоне не
 * появятся никогда: экрана, куда за ними идти, пользователь не знает), явный
 * отказ запоминается и больше не тревожит.
 */
export async function syncPushRegistration(): Promise<void> {
  if (storedPref() === '0') return;
  await enablePush();
}

/**
 * Куда ведёт нажатие на уведомление. Единственная зацепка — `tag`, который
 * бэкенд кладёт в `data`: он же служит ключом схлопывания на вебе, поэтому
 * второго поля заводить не пришлось.
 */
function routeForTag(tag: string): void {
  const state = useAnoonStore.getState();

  // Личный чат с другом: тег назван uid-ом отправителя, он же p2p-топик.
  if (tag.startsWith('msg:usr')) {
    const topic = tag.slice('msg:'.length);
    const friend = state.friends.find((f) => f.topic === topic);
    if (friend) {
      state.setChatTarget(friend);
      router.navigate('/private-chat');
      return;
    }
  }
  // Пара из рулетки (анонимная или раскрытая) — всегда grp-топик.
  if (tag.startsWith('msg:grp') || tag === 'roulette_match') {
    router.navigate(state.activeMatch ? '/anon-chat' : '/(tabs)/chats');
    return;
  }
  if (tag === 'friend_request' || tag === 'friend_accepted') {
    router.navigate('/(tabs)/friends');
    return;
  }
  router.navigate('/(tabs)/chats');
}

/**
 * Вся работа с пушами, которую делает корневой layout: регистрация после входа
 * и открытие по нажатию того чата, о котором было уведомление, а не просто
 * приложения.
 *
 * `useLastNotificationResponse` вместо слушателя — потому что чаще всего
 * приложение в этот момент ЗАПУСКАЕТСЯ: слушатель, повешенный в эффекте,
 * опаздывает к событию, а хук отдаёт его и после монтирования. По той же
 * причине здесь ждут `userId`: на холодном старте вход по токену ещё идёт, и
 * навигация в чат до него улетела бы в онбординг. Как только сессия появится,
 * эффект прогонится ещё раз с тем же ответом.
 */
export function usePush(): void {
  const userId = useAnoonStore((s) => s.user?.id);
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!userId) return;
    void syncPushRegistration();
  }, [userId]);

  useEffect(() => {
    if (!response || !userId) return;
    // Иначе тот же ответ снова уведёт из приложения при следующем рендере.
    Notifications.clearLastNotificationResponse();
    const tag = response.notification.request.content.data?.tag;
    routeForTag(typeof tag === 'string' ? tag : '');
  }, [response, userId]);
}
