/* F-35A Simülatör – Service Worker */
const CACHE_VERSION = '1.4.0';
const CACHE_NAME = 'f35a-sim-' + CACHE_VERSION;
const THREE_VERSION = '0.170.0';
const CDN_BASE = 'https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION + '/';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/main.js',
  './js/version.js',
  './js/noise.js',
  './js/textures.js',
  './js/world.js',
  './js/aircraft.js',
  './js/physics.js',
  './js/controls.js',
  './js/hud.js',
  './js/audio.js',
  './js/cameras.js',
  './js/ui.js',
];
const ICON_FILES = ['./icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
const CDN_FILES = [
  CDN_BASE + 'build/three.module.js',
  CDN_BASE + 'examples/jsm/utils/BufferGeometryUtils.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.concat(ICON_FILES));
    // CDN dosyaları ayrı ayrı; biri başarısız olsa bile kurulum devam eder.
    await Promise.allSettled(CDN_FILES.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return p.endsWith('/') || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.webmanifest');
}

function isCacheFirst(url) {
  if (url.href.startsWith(CDN_BASE)) return true;
  return url.origin === self.location.origin && url.pathname.includes('/icons/');
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: 'no-cache' });
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (req.mode === 'navigate' || isAppShell(url)) {
    event.respondWith(networkFirst(req));
  } else if (isCacheFirst(url)) {
    event.respondWith(cacheFirst(req));
  }
});
