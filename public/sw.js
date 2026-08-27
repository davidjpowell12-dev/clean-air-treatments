const CACHE_NAME = 'clean-air-v130';

// Paths are listed WITHOUT ?v= on purpose. This list used to carry version
// numbers that had to be kept in sync with app.html by hand, and it drifted
// constantly — six files were stale at once — which quietly broke offline
// fallback and made "I deployed a fix but still see the old thing" hard to
// diagnose. app.html is now the single place versions live; the offline
// lookup below matches while ignoring the query string.
const STATIC_ASSETS = [
  '/',
  '/app',
  '/index.html',
  '/app.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/pages/activate.js',
  '/js/utils/api.js',
  '/js/utils/offline.js',
  '/js/pages/dashboard.js',
  '/js/pages/messaging.js',
  '/js/pages/products.js',
  '/js/pages/inventory.js',
  '/js/pages/calculator.js',
  '/js/pages/applications.js',
  '/js/pages/properties.js',
  '/js/pages/ipm.js',
  '/js/pages/scheduling.js',
  '/js/pages/estimates.js',
  '/js/pages/invoicing.js',
  '/js/pages/settings.js',
  '/js/pages/follow-ups.js',
  '/js/pages/client-notes.js',
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
      // Offline — try cache. ignoreSearch so a request for
      // scheduling.js?v=37 still matches the precached scheduling.js;
      // without it, every version bump would silently lose offline support
      // for that file until it happened to be fetched again.
      return caches.match(request, { ignoreSearch: true }).then((cached) => {
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
