// Version: 1.2.11 - 2026-01-02 23.45.20
// © Christian Vemmelund Helligsø

const CACHE_NAME = 'boligbirding-v1.2.11';
const PRECACHE_URLS = [
  '/',              // startside
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Brug addAll i et try/catch, så en enkelt 404 ikke vælter installationen
      try {
        await cache.addAll(PRECACHE_URLS);
      } catch (e) {
        console.warn('Nogle filer kunne ikke caches ved install:', e);
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Ryd gamle caches
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  event.respondWith(
    caches.match(request).then((cached) => {
      // Cache-first med netværks-fallback
      return cached || fetch(request).then((resp) => {
        // (valgfrit) dynamisk cache af GET-requests
        if (request.method === 'GET' && resp && resp.status === 200 && resp.type === 'basic') {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, respClone));
        }
        return resp;
      }).catch(() => {
        // (valgfrit) returnér en offline-side eller et fallback-ikon her
        return cached; // sidste udvej
      });
    })
  );
});
