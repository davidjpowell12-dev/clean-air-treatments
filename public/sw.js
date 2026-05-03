const CACHE_NAME = 'clean-air-v87';
const STATIC_ASSETS = [
  '/',
  '/app',
  '/index.html',
  '/app.html',
  '/css/styles.css?v=27',
  '/js/app.js?v=27',
  '/js/pages/activate.js?v=4',
  '/js/utils/api.js?v=25',
  '/js/utils/offline.js?v=24',
  '/js/pages/dashboard.js?v=27',
  '/js/pages/messaging.js?v=2',
  '/js/pages/products.js?v=24',
  '/js/pages/inventory.js?v=25',
  '/js/pages/calculator.js?v=24',
  '/js/pages/applications.js?v=28',
  '/js/pages/properties.js?v=28',
  '/js/pages/ipm.js?v=24',
  '/js/pages/scheduling.js?v=33',
  '/js/pages/estimates.js?v=37',
  '/js/pages/invoicing.js?v=36',
  '/js/pages/settings.js?v=34',
  '/js/pages/follow-ups.js?v=3',
  '/js/lib/html5-qrcode.min.js',
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
        // (but not for the public proposal page, which is standalone)
        if (request.mode === 'navigate' && !url.pathname.startsWith('/proposal/')) {
          return caches.match('/app.html');
        }
      });
    })
  );
});
