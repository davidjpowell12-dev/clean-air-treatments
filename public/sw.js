const CACHE_NAME = 'clean-air-v8';
const STATIC_ASSETS = [
  '/',
  '/app',
  '/index.html',
  '/app.html',
  '/css/styles.css?v=8',
  '/js/app.js?v=8',
  '/js/utils/api.js?v=8',
  '/js/utils/offline.js?v=8',
  '/js/pages/dashboard.js?v=8',
  '/js/pages/products.js?v=8',
  '/js/pages/inventory.js?v=8',
  '/js/pages/calculator.js?v=8',
  '/js/pages/applications.js?v=8',
  '/js/pages/properties.js?v=8',
  '/js/pages/ipm.js?v=8',
  '/js/pages/settings.js?v=8',
  '/logo.png',
  '/manifest.json'
];

// Install — cache static assets for offline fallback
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — NETWORK FIRST for everything (cache is offline fallback only)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls — network only, no caching
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(JSON.stringify({ error: 'Offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // All other requests — network first, cache fallback
  event.respondWith(
    fetch(request).then((response) => {
      // Update cache with fresh response
      if (response.ok && request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clone);
        });
      }
      return response;
    }).catch(() => {
      // Offline — try cache
      return caches.match(request).then((cached) => {
        if (cached) return cached;
        // If offline and no cache for a navigation, return app shell
        if (request.mode === 'navigate') {
          return caches.match('/app.html');
        }
      });
    })
  );
});
