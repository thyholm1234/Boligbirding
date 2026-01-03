// Version: 1.3.4 - 2026-01-04 00.48.32
// © Christian Vemmelund Helligsø

const CACHE_NAME = 'boligbirding-v1.3.4';
const PRECACHE_URLS = [
  '/', '/index.html', '/style.css', '/app.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // >>> VIGTIGT: bypass browserens HTTP-cache <<<
    const requests = PRECACHE_URLS.map(
      (url) => new Request(url, { cache: 'reload' })
    );

    try {
      await cache.addAll(requests);
    } catch (e) {
      console.warn('Nogle filer kunne ikke caches ved install:', e);
    }
    self.skipWaiting(); // behold
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    self.clients.claim(); // behold
  })());
});

// Optionelt: network-first for navigationer, så index.html altid kan opdatere hurtigt
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Undgå cache for alle API-kald (alt under /api)
  if (request.url.includes('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // HTML navigationer (SPA/MPA) — hent netværk først, fald tilbage til cache ved offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((resp) => {
        if (request.method === 'GET' && resp && resp.status === 200 && resp.type === 'basic') {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, respClone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});