/* WAW service worker — кэш статики.
   • HTML (навигация): всегда сначала сеть, кэш — только офлайн-фолбэк.
   • Свои css/js/manifest: сначала сеть, кэш — офлайн-фолбэк (правки в main видны сразу).
   • Свои картинки и иконки: stale-while-revalidate.
   • CDN-библиотеки и шрифты: stale-while-revalidate.
   • Supabase, Worker и любые другие API — НИКОГДА не кэшируются. */
const VERSION = "waw-20261114-1";
const STATIC_CACHE = VERSION + "-static";
const CDN_CACHE = VERSION + "-cdn";
const CDN_HOSTS = new Set([
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);
const PRECACHE = ["./", "icons/logo-violet.webp", "icons/icon-192.png", "manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(res) {
  return res && (res.ok || res.type === "opaque");
}


async function networkFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === "navigate" ? await cache.match("./") : undefined);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => { if (cacheable(res)) cache.put(req, res.clone()); return res; })
    .catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range") || req.headers.has("authorization")) return;
  const url = new URL(req.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  if (url.origin === self.location.origin) {
    // только файлы внутри scope (/waw.ai/)
    if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
    if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
      event.respondWith(networkFirst(req));
      return;
    }
    if (url.pathname.endsWith("/sw.js")) return;
    // иконки и картинки меняются редко — SWR; css/js — сначала сеть,
    // чтобы правки прямо в main (без смены ?v) никогда не «залипали» в кэше
    if (/\.(png|webp|jpe?g|svg|ico)$/i.test(url.pathname)) event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    else event.respondWith(networkFirst(req));
    return;
  }

  if (CDN_HOSTS.has(url.hostname)) {
    // скрипты с CDN приходят как opaque (статус не виден) — поэтому SWR:
    // отдаём из кэша мгновенно и тихо обновляем, чтобы не «залипнуть» на ошибочном ответе
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
  }
  // всё остальное (supabase.co, workers.dev, Google OAuth…) — мимо SW
});
