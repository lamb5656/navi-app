// /browser-navi/sw.js
// PWA Service Worker (cache-first for app shell, no-cache for APIs)

const CACHE_NAME = 'navi-v5'; // bump this to force refresh
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './config.js',              // important: precache config
  './js/main.js',
  './js/ui.js',
  './js/nav.js',
  './js/map.js',
  './js/settings.js',
  './js/libs/net.js',
  './js/libs/maplibre-loader.js',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
];

// Helper: detect API paths (only if same-origin in the future)
function isApiPath(pathname) {
  return pathname.includes('/geocode') || pathname.includes('/route') || pathname.includes('/health');
}

self.addEventListener('install', (event) => {
  // take control ASAP
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL).catch(() => {
        // ignore failures (e.g., first load while offline)
      })
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const scopeURL = new URL(self.registration.scope);
  const isSameOrigin = url.origin === scopeURL.origin;
  const basePath = scopeURL.pathname; // e.g. "/navi-app/browser-navi/"

  // Never intercept cross-origin requests (tiles, workers.dev, etc.)
  if (!isSameOrigin) {
    // Explicitly avoid caching API on workers.dev if intercepted by some browsers
    if (url.hostname.endsWith('workers.dev')) {
      event.respondWith(fetch(req)); // network-only, no cache
    }
    return;
  }

  // Only handle within our app folder
  if (!url.pathname.startsWith(basePath)) return;

  // Network-only for API-like endpoints (future-proof if API_BASE becomes same-origin)
  if (isApiPath(url.pathname)) {
    event.respondWith(fetch(req)); // do not cache
    return;
  }

  // Cache-first for app shell & static assets
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      // Cache successful same-origin GET responses
      if (res && res.ok) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // Offline fallback: return whatever we have (if any)
      return cached || Response.error();
    }
  })());
});
