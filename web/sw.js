const CACHE = "waynes-shell-v274-formattag";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/styles.css?v=261",
  "/themes.css",
  "/themes.css?v=154",
  "/app.js",
  "/app.js?v=245",
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

function refreshShell(request, timeoutMs) {
  const controller = new AbortController();
  // Keep short — Tailscale-off / Mac-unreachable used to stall Android PWA open for 15s+.
  const timer = setTimeout(() => controller.abort(), timeoutMs == null ? 2500 : timeoutMs);
  return fetch(new Request(request, { cache: "no-store" }), { signal: controller.signal })
    .then((response) => {
      if (!response || !response.ok) return null;
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
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
  // Versioned CSS/JS: prefer network so phone PWAs pick up layout fixes.
  const networkFirst =
    url.pathname === "/styles.css" ||
    url.pathname === "/themes.css" ||
    url.pathname === "/app.js" ||
    url.pathname === "/index.html" ||
    url.pathname === "/";
  event.respondWith((async () => {
    if (networkFirst) {
      // Cache-first open so Tailscale-off / unreachable Mac still launches the PWA instantly.
      // Background refresh still picks up new shells when the Mac is reachable.
      const cached = await cachedShell(request);
      if (cached) {
        event.waitUntil(refreshShell(request, 4000).then(() => undefined));
        return cached;
      }
      const fresh = await refreshShell(request, 2500);
      if (fresh) return fresh;
      if (request.mode === "navigate") {
        return (await caches.match("/index.html")) || (await caches.match("/")) || offlineResponse();
      }
      return offlineResponse();
    }
    const cached = await cachedShell(request);
    if (cached) return cached;
    const fresh = await refreshShell(request, 2500);
    if (fresh) return fresh;
    if (request.mode === "navigate") {
      return (await caches.match("/index.html")) || (await caches.match("/")) || offlineResponse();
    }
    return offlineResponse();
  })());
});