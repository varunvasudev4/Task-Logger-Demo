// Network-first service worker: always tries the server for the newest files,
// falls back to the cached copy only when offline.
// It only touches the Cache Storage — localStorage / IndexedDB are never read or changed.
const CACHE = 'ttl-pwa-v2';          // bump this number on any release if you want to force a clean cache
const ASSETS = ['./', './tasklogger.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(new Request(a, { cache: 'reload' })).catch(() => {}))))
  );
  self.skipWaiting();                 // activate the new worker immediately
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('ttl-pwa-') && k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();               // take control of open tabs right away
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch POST/PUT etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // Drive API, fonts, CDNs: let the browser handle them

  e.respondWith(
    fetch(req, { cache: 'no-cache' })                      // bypass the browser HTTP cache too
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));  // keep an offline copy of the latest version
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./tasklogger.html') || caches.match('./')))
  );
});
