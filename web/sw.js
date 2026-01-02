// Version: 1.2.1 - 2026-01-02 23.21.42
// © Christian Vemmelund Helligsø
const CACHE_NAME = "boligbirding-v1.2.1";
const urlsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.webmanifest",
  // Tilføj evt. flere filer, fx ikoner
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});