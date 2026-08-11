/**
 * App entry (`package.json` → `main`). Its only job is to install the native
 * platform adapter BEFORE expo-router pulls in the first screen: the shared
 * modules read the adapter at module scope (`USE_TINODE`, `COMPANION_URL`), so
 * whatever is installed after they load would be ignored.
 */
import { setPlatform } from '@/lib/platform';

import { nativePlatform } from './platform';

setPlatform(nativePlatform);

// tinode-sdk deletes its IndexedDB cache in the constructor even with
// `persist: false`, and React Native has no indexedDB — the call rejects with
// "Cannot read properties of undefined (reading 'deleteDatabase')". The SDK
// reads the global once, when it is first imported (lazily, from
// `getTinodeClient`), so a stub planted here is in place in time. We never
// persist anything, so "deleted, successfully" is the honest answer.
const g = globalThis as { indexedDB?: unknown };
g.indexedDB ??= {
  deleteDatabase() {
    const request: { onsuccess?: (e: unknown) => void } = {};
    setTimeout(() => request.onsuccess?.({}), 0);
    return request;
  },
};

// `require`, not a static import: static imports are hoisted, and this one has
// to run AFTER the adapter is installed. It cannot be `import()` either —
// expo-router/entry registers the root component, and RN wants that to happen
// while the bundle is still evaluating, not a tick later.
declare const require: (module: string) => unknown;
require('expo-router/entry');
