// Service worker for the installed app (generated into dist/sw.js by tools/build-pages.mjs).
// Code & data: network-first (fresh when online, cached when offline). Map geometry, icons, CDN libs, fonts: cache-first.
const VERSION = '3d00929782';
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
  "./js/landmarks.js",
  "./js/main.js",
  "./js/map.js",
  "./js/world.js",
  "./manifest.webmanifest"
];
const CDN = [
  "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/MapControls.js",
  "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // CDN files are best-effort: a flaky connection must not block the install
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mokbang6-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') { const shell = await c.match('./index.html'); if (shell) return shell; }
    throw new Error('offline and not cached');
  }
}
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
    if (req.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/')) e.respondWith(networkFirst(req));
    else e.respondWith(cacheFirst(req));
    return;
  }
  if (/^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) e.respondWith(cacheFirst(req));
});
