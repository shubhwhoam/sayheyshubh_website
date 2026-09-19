// SayHeyShubh service worker.
// Bump CACHE_NAME whenever you want to force everyone's cached assets to
// refresh (e.g. after a CSS/JS change you need to land immediately).
const CACHE_NAME = 'sayheyshubh-v1';

// Only the true "app shell" - small, shared, safe to cache aggressively.
// Do NOT add PDF/API/auth routes here.
const APP_SHELL = [
  '/',
  '/style.css',
  '/script.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only ever handle same-origin GET requests. Everything else (Firebase,
  // Firestore, your Cloudflare Worker on workers.dev, Netlify Functions,
  // Razorpay, analytics, etc.) is left completely untouched and goes
  // straight to the network exactly like it does without a service worker.
  // This matters most for secure-notes / the PDF proxy: those URLs are
  // short-lived and signed per-request, so they must never be cached or
  // intercepted.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Never cache the Netlify Functions API surface, even if same-origin.
  if (url.pathname.startsWith('/.netlify/functions/')) {
    return;
  }

  // HTML pages: network-first, so logged-in users always see fresh
  // content when online. Falls back to cache only if truly offline.
  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req).then((res) => res || caches.match('/')))
    );
    return;
  }

  // Static assets (css, js, images, icons): cache-first for speed, with
  // a network fallback that also refreshes the cache for next time.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      });
    })
  );
});
