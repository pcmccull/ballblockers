// Service worker template. vite.config.js fills in the precache list and cache
// version at build time with every file in the build output, so the whole game
// is stored on install and plays offline.
const CACHE = 'ballblockers-__VERSION__';
const PRECACHE = __PRECACHE__;
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@500;600;700&display=swap';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Fetch the Google Fonts stylesheet and every font file it points to
async function cacheFonts(cache) {
  try {
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    await cache.put(FONT_CSS, res.clone());
    const css = await res.text();
    const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(urls.map(u => cache.add(u).catch(() => {})));
  } catch {
    // Offline during install: fonts fall back to runtime caching later
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map(p => new URL(p, self.registration.scope).href));
    await cacheFonts(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('ballblockers-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App launches always get the cached page, so it opens with no connection
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const index = new URL('index.html', self.registration.scope).href;
      return (await cache.match(index, { ignoreVary: true })) || fetch(req);
    })());
    return;
  }

  if (url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: Vite's crossorigin script/style requests carry an Origin
      // header the precache requests didn't, and servers often send Vary: Origin
      const hit = await cache.match(req, { ignoreSearch: url.origin === self.location.origin, ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
  }
});
