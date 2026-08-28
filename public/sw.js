// UAAPHIL Tournament System - Static App Shell Service Worker
// Version: uaaphil-static-v2

const CACHE_NAME = 'uaaphil-static-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/logo.webp'
];

// Install Event - Precache foundational app shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {
        // Non-fatal if specific asset cannot be precached during installation
      });
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate Event - Safely clean up old UAAPHIL static caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('uaaphil-static-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch Event - Strict Static-Only Caching with Network-Only for all API/Supabase/Mutations
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 1. Absolute rule: Non-GET requests (POST, PUT, PATCH, DELETE) are NEVER cached or intercepted
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 2. Absolute rule: NEVER cache Supabase API, Auth, REST, RPC, WebSocket, or Realtime requests
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/realtime/v1') ||
    url.pathname.startsWith('/api/') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return; // Let standard network handle it directly
  }

  // 3. Only handle same-origin static resources
  if (url.origin !== self.location.origin) {
    return;
  }

  // 4. Navigation requests (HTML) - Network first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('/index.html').then((cachedIndex) => {
            return cachedIndex || caches.match('/');
          });
        })
    );
    return;
  }

  // 5. Static Assets (JS, CSS, images, fonts, icons) - Stale-while-revalidate / Cache-first fallback
  const isStaticAsset =
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webmanifest');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
