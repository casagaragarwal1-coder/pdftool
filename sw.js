/* =========================================================================
   PDF TOOL — Service Worker
   Bump CACHE_VERSION every time you change index.html or any asset.
   That single change is what pushes an update out to installed users.
   ========================================================================= */

const CACHE_VERSION = 'pdftool-v1';
const OFFLINE_URL = './offline.html';

/* Files cached at install time — the "app shell".
   Everything here must exist, or install fails silently and nothing caches. */
const PRECACHE_URLS = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png'
  // ── Add any CDN libs your tool uses so it truly works offline, e.g.:
  // 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  // 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
];

/* ---------- INSTALL: precache the shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll is all-or-nothing; add individually so one bad CDN URL
      // doesn't kill the whole install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            console.warn('[SW] Precache skipped:', url, err);
          }
        })
      );
    })()
  );
  // Do NOT skipWaiting here — we let the page decide, so the user
  // isn't interrupted mid-task. See the UPDATE message handler below.
});

/* ---------- ACTIVATE: bin old caches ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET. Never intercept POST/PUT etc.
  if (req.method !== 'GET') return;

  // Ignore browser-extension and non-http schemes
  if (!req.url.startsWith('http')) return;

  // 1) NAVIGATION (the HTML page itself) → network-first, so you always
  //    get the newest tool when online; fall back to cache, then offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) {
            const c = await caches.open(CACHE_VERSION);
            c.put('./index.html', preload.clone());
            return preload;
          }
          const fresh = await fetch(req);
          const c = await caches.open(CACHE_VERSION);
          c.put('./index.html', fresh.clone());
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE_VERSION);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            (await cache.match(OFFLINE_URL))
          );
        }
      })()
    );
    return;
  }

  // 2) EVERYTHING ELSE (icons, css, js, fonts, CDN libs)
  //    → cache-first with background refresh (stale-while-revalidate).
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);

      const network = fetch(req)
        .then((res) => {
          // Cache good responses. Opaque (CDN, no-CORS) responses have
          // status 0 — still worth caching for offline use.
          if (res && (res.status === 200 || res.type === 'opaque')) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);

      return cached || (await network) || Response.error();
    })()
  );
});

/* ---------- UPDATE HANDSHAKE ----------
   index.html posts {type:'SKIP_WAITING'} when the user clicks "Update".  */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
