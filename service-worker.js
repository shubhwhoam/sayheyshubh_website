// Kill-switch service worker.
//
// An earlier version of this file (Sept 2026, "add to homescreen" feature) cached
// style.css, script.js and every other static asset cache-first, forever. The
// feature was removed from the site, but browsers that visited while it was live
// still have that old worker installed, and it keeps serving stale CSS/JS.
//
// Browsers re-check this exact URL on their own. When they find this file they
// install it, it deletes every cache the old worker created, unregisters itself,
// and from then on every request goes straight to the network like a normal site.
// There is deliberately NO fetch handler here.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
  })());
});
