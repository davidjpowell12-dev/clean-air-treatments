const CACHE_NAME = 'clean-air-v3';
const STATIC_ASSETS = [
  '/',
  '/app',
  '/index.html',
  '/app.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/utils/api.js',
  '/js/utils/offline.js',
  '/js/pages/dashboard.js',
  '/js/pages/products.js',
  '/js/pages/inventory.js',
  '/js/pages/calculator.js',
  '/js/pages/applications.js',
  '/js/pages/properties.js',
  '/js/pages/ipm.js',
  '/js/pages/settings.js',
  '/logo.png',
  '/manifest.json'
];

// Install — cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
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

// Fetch — network first for API, cache first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't cache API calls — always go to network
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

  // Static assets — cache first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      }).catch(() => {
        // If offline and no cache, return the app shell
        if (request.mode === 'navigate') {
          return caches.match('/app.html');
        }
      });
    })
  );
});
