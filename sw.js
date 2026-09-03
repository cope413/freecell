// Service worker: precache the app shell so FreeCell works offline.
// Bump CACHE_VERSION whenever any shell file changes.
const CACHE_VERSION = 'v1.0.3';
const CACHE_NAME = `freecell-${CACHE_VERSION}`;
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/engine.js',
  './src/game.js',
  './src/solver.js',
  './src/solver-worker.js',
  './src/storage.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'no-cache' bypasses the browser HTTP cache, so a new version
  // always precaches fresh files instead of stale max-age copies.
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Cache-first for same-origin GETs; fall back to network, then to index.html for navigations.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
