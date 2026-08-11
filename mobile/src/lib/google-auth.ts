import { AuthRequest, exchangeCodeAsync, ResponseType } from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Нативный вход через Google.
 *
 * Веб получает id_token от Google Identity Services — браузерного скрипта
 * (`frontend/src/components/anoon/GoogleSignInButton.tsx`). На телефоне его нет,
 * поэтому здесь обычный OAuth-код с PKCE через системный браузер
 * (`expo-auth-session`), а id_token достаётся из обмена кода на токены. Бэкенду
 * уходит ровно тот же вид токена, что и с веба: `POST /auth/oauth/google`
 * с `idToken` (см. `signInWithGoogle` в общем сторе).
 *
 * ВАЖНО про `aud`. Companion сверяет `aud` токена ровно с одним client id
 * (`COMPANION_GOOGLE_CLIENT_ID`, см. `internal/oauth/google.go`), а нативный
 * клиент получает токен с `aud` СВОЕГО client id — вебовый сюда не годится:
 * Google не пускает custom-scheme redirect для клиентов типа «Web». Значит
 * companion обязан принимать список audience — до этого вход с телефона будет
 * честно отвергнут как `invalid_token`.
 *
 * Redirect тоже не `anoon://`: Google жёстко требует свои схемы —
 * `<package>:/oauthredirect` для Android-клиента и перевёрнутый client id
 * (`com.googleusercontent.apps.…:/oauthredirect`) для iOS-клиента.
 */

const CLIENT_IDS = {
  android: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? '',
  ios: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? '',
} as const;

/** Схема Android-redirect — это имя пакета, второго источника правды не заводим. */
const ANDROID_PACKAGE =
  (Constants.expoConfig?.android?.package as string | undefined) ?? 'com.anoon.app';

/** Expo Go живёт на `exp://`, который Google для этих client id не примет. */
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

/** `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`. */
function reversedIosScheme(clientId: string): string | null {
  const m = /^(.+)\.apps\.googleusercontent\.com$/.exec(clientId.trim());
  return m ? `com.googleusercontent.apps.${m[1]}` : null;
}

export function googleClientId(os: string = Platform.OS): string {
  if (os === 'ios') return CLIENT_IDS.ios;
  if (os === 'android') return CLIENT_IDS.android;
  return '';
}

export function googleRedirectUri(os: string = Platform.OS, clientId = googleClientId(os)): string | null {
  if (os === 'android') return `${ANDROID_PACKAGE}:/oauthredirect`;
  if (os === 'ios') {
    const scheme = reversedIosScheme(clientId);
    return scheme && `${scheme}:/oauthredirect`;
  }
  return null;
}

/**
 * Почему кнопка выключена, или `null`, если всё готово. Сборка без client id
 * обязана показывать причину: нажимаемая кнопка, которая может только упасть,
 * хуже видимо недоступной.
 */
export function googleDisabledReason(os: string = Platform.OS): string | null {
  if (os !== 'ios' && os !== 'android') return 'Вход через Google доступен только в приложении';
  if (IS_EXPO_GO) return 'Вход через Google не работает в Expo Go — нужна сборка приложения';
  if (!googleClientId(os)) {
    return os === 'ios'
      ? 'Вход через Google не настроен: нет EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS'
      : 'Вход через Google не настроен: нет EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID';
  }
  if (!googleRedirectUri(os)) return 'Неверный формат iOS client id для Google';
  return null;
}

/** Готовый запрос авторизации (PKCE включён по умолчанию в `AuthRequest`). */
export function googleAuthRequest(os: string = Platform.OS): AuthRequest {
  const clientId = googleClientId(os);
  return new AuthRequest({
    clientId,
    redirectUri: googleRedirectUri(os, clientId) ?? '',
    responseType: ResponseType.Code,
    scopes: ['openid', 'profile', 'email'],
    usePKCE: true,
    // Тот же смысл, что `auto_select: false` на вебе: это явный вход, и молча
    // подставленный аккаунт залогинил бы человека без его выбора.
    extraParams: { prompt: 'select_account' },
  });
}

/**
 * Открывает системный браузер и возвращает Google id_token.
 * `null` — человек закрыл окно; это не ошибка и показывать её нечего.
 */
export async function promptGoogleIdToken(): Promise<string | null> {
  const reason = googleDisabledReason();
  if (reason) throw new Error(reason);

  const request = googleAuthRequest();
  const result = await request.promptAsync(GOOGLE_DISCOVERY);
  if (result.type !== 'success') {
    if (result.type === 'error') {
      throw new Error(result.error?.message ?? 'Google отказал во входе');
    }
    return null;
  }

  const tokens = await exchangeCodeAsync(
    {
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      code: result.params.code,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    GOOGLE_DISCOVERY,
  );
  if (!tokens.idToken) throw new Error('Google не вернул id_token');
  return tokens.idToken;
}
