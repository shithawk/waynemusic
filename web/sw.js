const CACHE = "waynes-shell-v137";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/styles.css?v=196",
  "/themes.css",
  "/themes.css?v=153",
  "/app.js",
  "/app.js?v=136",
  "/heroes/jori.jpg",
  "/heroes/joriBW.jpg",
  "/heroes/wayne.jpeg",
  "/heroes/wayneBW.jpg",
  "/heroes/jacobLiquid.jpg",
  "/heroes/jacob.jpg",
  "/heroes/jacobBW.jpg",
  "/heroes/dan.jpg",
  "/heroes/danBW.jpg",
  "/heroes/steff.jpg",
  "/heroes/steffBW.jpg",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/youtube-logo.png?v=jyt1",
  "/car.jpeg",
  "/icon-180.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function offlineResponse() {
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

function refreshShell(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  return fetch(new Request(request, { cache: "no-cache" }), { signal: controller.signal })
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    })
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

function shellCacheIgnoresQuery(pathname) {
  return !(
    pathname === "/styles.css" ||
    pathname === "/themes.css" ||
    pathname === "/app.js"
  );
}

async function cachedShell(request) {
  const exact = await caches.match(request);
  if (exact) return exact;
  const pathname = new URL(request.url).pathname;
  if (shellCacheIgnoresQuery(pathname)) {
    const ignored = await caches.match(request, { ignoreSearch: true });
    if (ignored) return ignored;
  }
  if (request.mode === "navigate") {
    return (await caches.match("/index.html")) || (await caches.match("/"));
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (
    url.pathname === "/sw.js" ||
    url.pathname.startsWith("/music/") ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/catalog.json"
  ) {
    return;
  }

  const request = event.request;
  event.respondWith((async () => {
    const cached = await cachedShell(request);
    if (cached) return cached;
    const fresh = await refreshShell(request);
    if (fresh) return fresh;
    if (request.mode === "navigate") {
      return (await caches.match("/index.html")) || (await caches.match("/")) || offlineResponse();
    }
    return offlineResponse();
  })());
  event.waitUntil((async () => {
    if (await cachedShell(request)) await refreshShell(request);
  })());
});