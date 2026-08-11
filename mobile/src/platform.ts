import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import type { PlatformAdapter, PlatformStorage } from '@/lib/platform';

/**
 * The native half of the platform adapter (`frontend/src/lib/platform.ts`).
 * Everything the shared store and clients need that a phone answers differently
 * from a browser.
 */

/** Backend origin. `app.json` → `expo.extra.backendUrl`, prod by default. */
const BACKEND_URL: string =
  (Constants.expoConfig?.extra?.backendUrl as string | undefined) ??
  'https://5-129-206-152.sslip.io';

/** `https://host` → `wss://host`, `http://host` → `ws://host`. */
const WS_ORIGIN = BACKEND_URL.replace(/^http/, 'ws');

/**
 * The OS keystore. Sync on both ends: `getItem`/`setItem` have synchronous
 * variants, which is what lets the shared store read a session inline exactly
 * as it does from `localStorage` on the web.
 *
 * ponytail: SecureStore values are capped at 2048 bytes on Android. The session
 * (token + user) is far below it; the roulette-friends mirror could pass it for
 * a heavy user, and a write that fails there just means that list does not
 * survive a restart (the call site already tolerates it). Split the non-secret
 * keys onto AsyncStorage if that ever bites.
 */
const keystore: PlatformStorage = {
  get(key) {
    try {
      const value = SecureStore.getItem(storeKey(key));
      // remove() blanks the value — see below.
      return value ? value : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      SecureStore.setItem(storeKey(key), value);
    } catch {
      /* over the size limit / keystore unavailable — it just won't persist */
    }
  },
  remove(key) {
    try {
      // Blank it synchronously so the very next get() misses, then drop the
      // entry for real in the background: SecureStore has no sync delete.
      SecureStore.setItem(storeKey(key), '');
      void SecureStore.deleteItemAsync(storeKey(key));
    } catch {
      /* ignore */
    }
  },
};

/** SecureStore keys must be alphanumeric + `._-`; ours are `anoon:session`-ish. */
function storeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export const nativePlatform: PlatformAdapter = {
  // A phone has no page origin: both bases are absolute, straight from config.
  companionUrl: `${BACKEND_URL}/api`,
  companionWsBase: () => `${WS_ORIGIN}/api`,
  tinodeWsUrl: `${WS_ORIGIN}/v0/channels`,
  effectiveTinodeWsUrl: (configured) => configured,
  tinodeApiKey:
    (Constants.expoConfig?.extra?.tinodeApiKey as string | undefined) ??
    'AQEAAAABAAD_rAp4DJh05a1HAwFT3A6K',
  // A file ref is a path on the server, and the phone has nothing to resolve a
  // path against: an `<Image>` handed `/v0/file/s/…` loads nothing, silently.
  fileBaseUrl: BACKEND_URL,
  // There is no mock driver worth shipping on the phone: the app is only ever
  // pointed at a real backend.
  useTinode: true,
  storage: keystore,
  isClient: true,
  hasDom: false,
};
