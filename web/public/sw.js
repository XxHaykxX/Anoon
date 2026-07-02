// anoon web — service worker: Web Push + офлайн-кэш (без сборочной интеграции).
// TODO(prod): для точного precache хешированных ассетов — Serwist с build-манифестом.

const CACHE = "anoon-v6"; // bump: навигации → stale-while-revalidate (мгновенный запуск PWA)
const PRECACHE = ["/", "/offline", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Стратегии кэша (только GET):
// — навигации (запуск PWA / hard-reload): stale-while-revalidate — отдаём кэш оболочки
//   МГНОВЕННО, свежую версию тянем в фоне и кладём в кэш (следующий запуск уже новый).
//   Раньше был network-first → каждый запуск ждал сеть (на холодном serverless ~3с / слабой
//   сети — «страница долго открывается»). Свежесть после деплоя гарантирует version-poll в
//   app-providers (reload при смене /api/version), поэтому одна «на кадр устаревшая» отдача
//   безопасна. Клиентские переходы (RSC ?_rsc) сюда НЕ попадают (mode!=navigate) — идут в сеть.
// — статика (/_next/static, иконки): cache-first + фоновое обновление.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const fetchAndUpdate = fetch(request).then(async (fresh) => {
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        });
        if (cached) {
          // Отдаём кэш сразу, сеть обновляет кэш в фоне (не блокирует показ).
          event.waitUntil(fetchAndUpdate.catch(() => {}));
          return cached;
        }
        try {
          return await fetchAndUpdate;
        } catch {
          // Первый заход без кэша и офлайн — красивая офлайн-заглушка.
          return (await caches.match("/offline")) || (await caches.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  const isStatic = url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icon");
  if (isStatic) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return Response.error();
        }
      })(),
    );
  }
});

// --- Колокольчик уведомлений (BELL-DATA) ---
// Накапливаем каждый push в IndexedDB, чтобы приложение показало историю (не только системный
// тост, который легко пропустить/смахнуть). Читает эту же БД store/notifications.ts (client)
// при старте — сливает накопленное, пока вкладка была закрыта. Открытым вкладкам — live через
// postMessage (app-providers.tsx слушает 'message' на navigator.serviceWorker).
const NOTIF_DB = "anoon-notifs";
const NOTIF_STORE = "notifs";

function openNotifDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOTIF_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(NOTIF_STORE)) {
        req.result.createObjectStore(NOTIF_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveNotif(notif) {
  try {
    const db = await openNotifDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(NOTIF_STORE, "readwrite");
      tx.objectStore(NOTIF_STORE).put(notif);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB недоступен (приватный режим и т.п.) — системный тост всё равно покажется.
  }
}

async function notifyClients(notif) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: "notif", payload: notif });
}

// --- Web Push ---
// Реальные push шлёт backend: pushToProfile/broadcastPush (web-push VAPID).
// Payload формы { title, body, url }; id/ts/read синтезирует SW ниже.
self.addEventListener("push", (event) => {
  let data = { title: "anoon", body: "У вас новое сообщение" };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      const text = event.data.text();
      if (text) data.body = text;
    }
  }

  // icon — крупная цветная PWA-иконка. badge — монохромный силуэт с прозрачным фоном
  // (Android/Samsung в свёрнутой шторке показывает badge; непрозрачная иконка = белый квадрат).
  // url нормализуем к пути от корня, чтобы клик не давал 404.
  let path = typeof data.url === "string" && data.url ? data.url : "/";
  if (!path.startsWith("/")) path = "/" + path;

  const options = {
    body: data.body,
    icon: "/icon-512.png",
    badge: "/badge-96.png",
    tag: data.tag || "anoon-push",
    data: { url: path },
  };

  const notif = {
    id: self.crypto && self.crypto.randomUUID ? self.crypto.randomUUID() : `n${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
    title: data.title,
    body: data.body,
    url: path,
    ts: Date.now(),
    read: false,
  };

  event.waitUntil(Promise.all([self.registration.showNotification(data.title, options), saveNotif(notif), notifyClients(notif)]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(raw, self.location.origin); // абсолютный same-origin URL

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Уже открыт клиент того же origin — фокусируем и ведём на нужный путь.
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client && client.url !== target.href) client.navigate(target.href).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target.href);
      return undefined;
    }),
  );
});
