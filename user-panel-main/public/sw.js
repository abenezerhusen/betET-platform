// 1birr.bet service worker.
//
// Bump the version every time you change ANY caching behaviour so existing
// installs invalidate their old caches on `activate`. The `activate` step
// below deletes every entry that doesn't start with the current prefix, so
// stale chunks (especially Next.js `/_next/...` files from prior builds)
// don't keep serving 404s after a deploy.
const SW_VERSION = 'v25';
const CACHE_NAME = `1birr-static-${SW_VERSION}`;
const DYNAMIC_CACHE = `1birr-dynamic-${SW_VERSION}`;

const STATIC_ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/1birr-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

// Activate — wipe ALL previously created caches that don't match the
// current version. This kills the stale-chunk problem at the source: any
// time the SW is updated, every previously cached `/_next/static/...`
// blob is dropped before the first fetch is intercepted.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== DYNAMIC_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

function shouldBypassCache(url) {
  // Next.js hashes every chunk and asset under `/_next/`, so its own cache
  // busting is authoritative — never let the SW intercept these or we'll
  // happily serve a stale chunk that no longer exists after a redeploy.
  if (url.pathname.startsWith('/_next/')) return true;
  // Hot-module-replacement pings during `next dev` must never be cached.
  if (url.pathname.startsWith('/__next') || url.pathname.includes('hot-update')) {
    return true;
  }
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Only handle same-origin GETs; let everything else pass through.
  if (url.origin !== self.location.origin) return;
  if (shouldBypassCache(url)) return;

  // API requests — network first, fall back to cached response only on
  // network failure (so the UI keeps working offline for cached endpoints).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches
              .open(DYNAMIC_CACHE)
              .then((cache) => cache.put(request, clone))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static page navigations & assets — cache first, network fallback.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          const clone = response.clone();
          caches
            .open(DYNAMIC_CACHE)
            .then((cache) => cache.put(request, clone))
            .catch(() => undefined);
          return response;
        })
        .catch(() => {
          const accept = request.headers.get('accept') || '';
          if (accept.includes('text/html')) {
            return caches.match('/offline.html');
          }
          return Response.error();
        });
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-bets') {
    event.waitUntil(Promise.resolve());
  }
});
