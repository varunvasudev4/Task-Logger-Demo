// Service worker.
// - Same-origin files (the app itself): network-first, cached copy only when offline.
// - A fixed list of CDN hosts (icon font, Google Fonts, moment.js): cache-first with a
//   background refresh, so the app opens with icons and fonts even offline.
// It only touches Cache Storage — localStorage / IndexedDB are never read or changed.
const CACHE = 'ttl-pwa-v3';            // bump on any release to force a clean app cache
const CDN_CACHE = 'ttl-cdn-v1';        // kept across app releases; bump only if a CDN file must be re-fetched
const ASSETS = ['./', './tasklogger.html', './manifest.json'];

// Exact hostnames only. www.googleapis.com (Drive API) is deliberately NOT listed.
const CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',          // Tabler icon font CSS + font files
  'fonts.googleapis.com',      // Google Fonts CSS
  'fonts.gstatic.com',         // Google Fonts font files
  'cdnjs.cloudflare.com'       // moment.js
]);

// Fetched at install so the first offline launch already has them.
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.41.1/dist/tabler-icons.min.css',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.30.1/moment.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(new Request(a, { cache: 'reload' })).catch(() => {})))),
    caches.open(CDN_CACHE)
      .then(c => Promise.all(CDN_PRECACHE.map(u =>
        c.match(u).then(hit => hit || fetchCors(u).then(res => res.ok && c.put(u, res))).catch(() => {})
      )))
  ]));
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

// CORS-mode fetch: these hosts all send CORS headers, and real (non-opaque) responses
// are cheap to store and let us check res.ok before caching.
function fetchCors(url) {
  return fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
}

function cdnFirst(req) {
  return caches.open(CDN_CACHE).then(cache =>
    cache.match(req.url).then(hit => {
      const refresh = fetchCors(req.url).then(res => {
        if (res && res.ok) cache.put(req.url, res.clone());
        return res;
      });
      if (hit) { refresh.catch(() => {}); return hit; }   // cached: serve now, refresh quietly
      return refresh;                                     // first time: go to network
    })
  );
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch POST/PUT etc.
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (CDN_HOSTS.has(url.hostname)) e.respondWith(cdnFirst(req));
    return;                                               // Drive API and anything else: browser handles it
  }

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
