// anoon web — service worker: Web Push + офлайн-кэш (без сборочной интеграции).
// TODO(prod): для точного precache хешированных ассетов — Serwist с build-манифестом.

const CACHE = "anoon-v3";
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
// — навигации: network-first → кэш → офлайн-оболочка "/".
// — статика (/_next/static, иконки): cache-first + фоновое обновление.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          // Офлайн: отдать кэш этой страницы, иначе красивую офлайн-заглушку.
          const cached = await caches.match(request);
          return cached || (await caches.match("/offline")) || (await caches.match("/")) || Response.error();
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

// --- Web Push ---
// Бэкенда рассылки нет — реальные push никто не шлёт (см. src/lib/push.ts, store/push.ts).
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

  // Иконка PWA (крупная, цветная). badge не задаём — Android берёт иконку приложения
  // как монохромный статус-значок (иначе цветной badge превращается в мусорный квадрат).
  // url нормализуем к пути от корня, чтобы клик не давал 404.
  let path = typeof data.url === "string" && data.url ? data.url : "/";
  if (!path.startsWith("/")) path = "/" + path;

  const options = {
    body: data.body,
    icon: "/icon-512.png",
    tag: data.tag || "anoon-push",
    data: { url: path },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
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
