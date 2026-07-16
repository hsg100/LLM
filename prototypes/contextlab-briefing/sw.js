/**
 * ContextLab Briefing — service worker.
 * Precaches the app shell and edition data so the briefing reloads offline
 * after one successful online load. Same-origin GETs are served cache-first
 * with a background refresh; navigations fall back to the cached shell.
 */

const VERSION = 'contextlab-briefing-v1';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.mjs',
  './model.mjs',
  './manifest.webmanifest',
  './data/stories.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // External requests (e.g. source links) pass through untouched; the UI
    // is honest that they need connectivity.
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        // Serve from cache immediately; refresh in the background.
        return cached;
      }
      return refresh.then((response) => {
        if (response) return response;
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      });
    }),
  );
});
