// sw.js (SwitchVoiceNavi)
// Version bump on every deploy to bust caches.
const VERSION = '2025-09-20-02';
const STATIC_CACHE = `svn-static-${VERSION}`;
const RUNTIME_CACHE = `svn-runtime-${VERSION}`;
const TILE_CACHE = `svn-tiles-${VERSION}`;

// Files safe to pre-cache (small, rarely changed)
const PRECACHE = [
  './',                // index.html (fallback)
  './styles.css',
  './config.js',
  './js/main.js',
  './js/ui.js',
  './vendor/maplibre-gl.css',
  './vendor/maplibre-gl.js',
];

// Utilities
const isNavigation = (req) => req.mode === 'navigate' || (req.headers && req.headers.get('accept')?.includes('text/html'));
const sameOrigin = (url) => new URL(url, self.location.href).origin === self.location.origin;
const isTile = (url) => /tile|tiles|tile\.openstreetmap|\.png|\.mvt|\.pbf/i.test(url);

// Install: pre-cache tiny core & take over immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => {})
  );
});

// Activate: clean old caches and control pages now
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(k))
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Fetch strategies:
// - HTML navigation: Network-First, fallback to cached index
// - Same-origin assets: Stale-While-Revalidate
// - Tiles/externals: Cache-First with soft cap
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // Only handle GET
  if (req.method !== 'GET') return;

  // HTML / navigation -> Network-First
  if (isNavigation(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        // Optionally update the cached index.html
        const cache = await caches.open(STATIC_CACHE);
        cache.put('./', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match('./');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Same-origin static assets -> Stale-While-Revalidate
  if (sameOrigin(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) cache.put(req, fresh.clone());
        } catch {}
      })();
      return cached || (await fetch(req).then(r=> {
        if (r && r.ok) cache.put(req, r.clone());
        return r;
      }).catch(()=> cached || new Response('', { status: 504 })));
    })());
    return;
  }

  // Tiles / cross-origin -> Cache-First (+soft cap)
  if (isTile(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req, { mode: 'cors' });
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone());
          pruneCache(cache, 800); // limit tile entries
        }
        return fresh;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }
});

// Soft limit cache size
async function pruneCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  const del = keys.length - max;
  for (let i = 0; i < del; i++) await cache.delete(keys[i]);
}
