/* anoon service worker — hand-rolled, no dependencies. */

const VERSION = "v2";
const STATIC_CACHE = `anoon-static-${VERSION}`;
const PAGES_CACHE = `anoon-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

/* Precache the offline fallback and core icons/manifest. */
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

/* Remove any caches that are not part of the current version. */
self.addEventListener("activate", (event) => {
  const keep = new Set([STATIC_CACHE, PAGES_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* Decide whether a request targets an HTML page (navigation). */
function isPageRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"))
  );
}

/* Decide whether a request targets a cacheable static asset. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname.startsWith("/videos/") ||
    /\.(?:css|js|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm)$/i.test(
      url.pathname
    )
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  /* Only handle GET; let the browser deal with everything else. */
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /* Never touch cross-origin requests. */
  if (url.origin !== self.location.origin) return;

  /* Network-first for page navigations, with offline fallback. */
  if (isPageRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGES_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        })
    );
    return;
  }

  /* Cache-first for static assets. */
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});

/* Push notifications (call/message/friend-request alerts from companion). */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "anoon";
  const options = {
    body: data.body || "Новое сообщение",
    icon: data.icon || "/icons/icon.svg",
    badge: data.badge || "/icons/icon.svg",
    tag: data.tag,
    data: { url: data.url || "/anoon" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* Focus an existing window (navigating it) or open a new one on click. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/anoon";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if ("navigate" in client) client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
