// Simple PWA SW for /browser-navi/ (Cache First app shell, gentle runtime caching)
const VERSION = 'v1.0.0';
const APP_CACHE = `svnavi-app-${VERSION}`;
const RUNTIME_CACHE = `svnavi-rt-${VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css'
];

// install: cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// activate: cleanup old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![APP_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// fetch: 
// 1) same-origin → Cache First
// 2) OSM tiles → stale-while-revalidate（控えめ）
// 3) ors-proxy → network-first（失敗時だけcache）
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // only handle GET
  if (e.request.method !== 'GET') return;

  if (isSameOrigin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        return cached || fetch(e.request).then(resp => {
          // cache new same-origin
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(e.request, copy));
          return resp;
        });
      })
    );
    return;
  }

  // OSM tiles
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(resp => {
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(e.request, copy));
          return resp;
        }).catch(() => cached || Response.error());
        return cached || fetchPromise;
      })
    );
    return;
  }

  // ors-proxy APIs → network-first
  if (url.hostname.endsWith('workers.dev')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(RUNTIME_CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // other cross-origin → pass-through
});
