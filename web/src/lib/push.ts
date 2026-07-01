// anoon web — Web Push (VAPID) клиентские хелперы.
// Подписка создаётся в браузере; отправку на backend (POST /push/subscribe) делает
// store/push.ts (нужен access-token). Рассылка — web-push при офлайн-получателе.

export const PUSH_SUPPORTED =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window.PushManager !== "undefined" &&
  typeof window.Notification !== "undefined";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!PUSH_SUPPORTED) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch (err) {
    console.warn("[push] не удалось зарегистрировать service worker", err);
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!PUSH_SUPPORTED) return null;
  // Ждём активации SW — иначе getSubscription может ложно вернуть null (Android) и сбросить тумблер.
  await navigator.serviceWorker.ready.catch(() => {});
  const reg = (await navigator.serviceWorker.getRegistration("/sw.js")) ?? (await navigator.serviceWorker.getRegistration());
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!PUSH_SUPPORTED) return null;

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    console.warn(
      "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY не задан (см. .env.example) — подписка на push невозможна без ключа.",
    );
    return null;
  }

  const reg = (await navigator.serviceWorker.getRegistration("/sw.js")) ?? (await registerServiceWorker());
  if (!reg) return null;
  // Android Chrome: subscribe до активации SW падает. Ждём активный worker.
  await navigator.serviceWorker.ready.catch(() => {});

  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  // Отправку `sub` на backend делает вызывающий (store/push.ts) — там есть access-token.
  return sub;
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getExistingSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  // TODO(backend): DELETE /api/push/subscribe — удалить подписку на сервере.
}
