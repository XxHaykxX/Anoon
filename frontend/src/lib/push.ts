/**
 * Web Push registration for anoon. Talks to the service worker (`public/sw.js`,
 * which owns the `push` / `notificationclick` listeners) and the companion
 * REST endpoints exposed via `./companion.ts` (`getVapidPublicKey`,
 * `savePushSubscription`, `removePushSubscription`).
 *
 * Browser-only and SSR-safe: every export guards `typeof window`.
 */
import {
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
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    await savePushSubscription(subscription.toJSON());
    return true;
  } catch {
    // NotAllowedError (permission denied), backend down, etc. — just fail
    // closed so the caller can show a "notifications unavailable" state.
    return false;
  }
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
