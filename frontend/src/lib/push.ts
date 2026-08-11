/**
 * Web Push registration for anoon. Talks to the service worker (`public/sw.js`,
 * which owns the `push` / `notificationclick` listeners) and the companion
 * REST endpoints exposed via `./companion.ts` (`getVapidPublicKey`,
 * `savePushSubscription`, `removePushSubscription`).
 *
 * Browser-only and SSR-safe: every export guards `typeof window`.
 */
import {
  CompanionHttpError,
  getVapidPublicKey,
  removePushSubscription,
  savePushSubscription,
} from "./companion";

/** Whether this browser can do Web Push at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Decode a URL-safe base64 VAPID key into the Uint8Array the Push API wants. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Register for push: wait for the SW, fetch the VAPID public key, subscribe
 * via the Push API, and persist the subscription with companion. Returns
 * whether it succeeded — never throws (permission denial / unsupported
 * browsers / backend errors all resolve to `false`).
 */
export async function subscribePush(): Promise<boolean> {
  if (typeof window === "undefined" || !pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const publicKey = await getVapidPublicKey();
    const applicationServerKey = urlBase64ToUint8Array(publicKey) as BufferSource;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    try {
      await savePushSubscription(subscription.toJSON());
      return true;
    } catch (err) {
      // 409 `endpoint_taken` — this push endpoint is already registered to a
      // different account (a shared browser, or a reinstall that handed back the
      // same endpoint). Dropping the browser subscription mints a brand-new
      // endpoint, which then inserts cleanly, so retry ONCE and the user simply
      // ends up with working notifications and never sees an error. Deliberately
      // not a loop: if the second attempt fails too, something else is wrong and
      // we fail closed like any other error.
      if (!(err instanceof CompanionHttpError) || err.status !== 409) throw err;
      await subscription.unsubscribe();
      const fresh = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      await savePushSubscription(fresh.toJSON());
      return true;
    }
  } catch {
    // NotAllowedError (permission denied), backend down, etc. — just fail
    // closed so the caller can show a "notifications unavailable" state.
    return false;
  }
}

/**
 * Local "the user asked for pushes" preference. Only a best guess — the browser
 * subscription is the truth — but it survives a reload before the async check
 * that reconciles it. Lives here, not on a screen, because two screens set it:
 * the settings toggle and the notifications banner.
 */
const PUSH_PREF_KEY = "anoon:notify:push";

export function isPushPrefEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PUSH_PREF_KEY) === "1";
}

export function setPushPrefEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PUSH_PREF_KEY, enabled ? "1" : "0");
}

/** Unregister push: cancel the browser subscription and tell companion. */
export async function unsubscribePush(): Promise<void> {
  if (typeof window === "undefined" || !pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await removePushSubscription(endpoint);
  } catch {
    /* best-effort cleanup */
  }
}
