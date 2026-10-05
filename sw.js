// Service worker for the installed app (generated into dist/sw.js by tools/build-pages.mjs).
// Each version is an exact snapshot: every shipped file is precached (bypassing the HTTP cache) under a
// cache named by the content hash, and served cache-first. Updates arrive only as a new sw.js; the page
// shows an "업데이트" button that tells the waiting worker to take over, then reloads once.
const VERSION = '62d9e2d2cc';
const CACHE = 'mokbang6-' + VERSION;
const CORE = [
  "./",
  "./geo/izu.json",
  "./geo/kix.json",
  "./geo/kobe.json",
  "./geo/narita.json",
  "./geo/osaka.json",
  "./geo/shirahama.json",
  "./geo/tokyo.json",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./js/chars.js",
  "./js/data/common.js",
  "./js/data/osaka.js",
  "./js/data/tokyo.js",
  "./js/journal.js",
  "./js/landmarks.js",
  "./js/main.js",
  "./js/map.js",
  "./js/share.js",
  "./js/world.js",
  "./manifest.webmanifest"
];
const CDN = [
  "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/MapControls.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js",
  "https://fonts.googleapis.com/css2?family=Jua&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap"
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    // CDN files are best-effort: a flaky connection must not block the install
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mokbang6-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') e.respondWith(caches.open(CACHE).then(c => c.match('./index.html')).then(r => r || fetch(req)));
    else e.respondWith(cacheFirst(req));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com') { // never let a stalled font stylesheet blank the screen
    e.respondWith(withTimeout(cacheFirst(req), 3000).catch(() => new Response('', { headers: { 'Content-Type': 'text/css' } })));
    return;
  }
  if (/^(cdn\.jsdelivr\.net|fonts\.gstatic\.com)$/.test(url.hostname)) e.respondWith(cacheFirst(req));
});
