import { getPostCacheName, POST_CACHE_POLICY, IMAGE_CACHE_POLICY, getImageCacheName, obsoleteContentCaches } from './cache-config.js';
import { pruneBoundedCache, putBoundedCache, matchBoundedCache } from './bounded-cache.js';

const scope = self.registration.scope;
const scopePath = new URL(scope).pathname;
const shellPrefix = 'reddit-lurker-shell-' + encodeURIComponent(scopePath) + '-';
const shellCacheName = shellPrefix + __BUILD_ID__;
const imageCacheName = getImageCacheName(scopePath);
const precache = __PRECACHE__;
const shellUrls = new Set(precache.map(path => new URL(path, scope).href));
const indexUrl = new URL('index.html', scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCacheName);
    await cache.addAll(precache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const obsolete = obsoleteContentCaches(names, scopePath);
    await Promise.all(names.filter(name => obsolete.includes(name) ||
      (name.startsWith(shellPrefix) && name !== shellCacheName)).map(name => caches.delete(name)));
    await Promise.all([
      pruneBoundedCache(imageCacheName, IMAGE_CACHE_POLICY),
      pruneBoundedCache(getPostCacheName(scopePath), POST_CACHE_POLICY),
    ]);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === new URL(scope).origin && url.pathname.startsWith(scopePath)) {
    event.respondWith(navigate(request));
    return;
  }
  // Only known build assets belong in the shell cache; query strings cannot grow it.
  if (shellUrls.has(request.url)) {
    event.respondWith(shellAsset(request));
    return;
  }
  const imageHosts = ['redd.it', 'redditmedia.com', 'imgur.com'];
  if (request.destination === 'image' && imageHosts.some(host =>
    url.hostname === host || url.hostname.endsWith('.' + host))) {
    const result = image(request);
    event.respondWith(result.then(value => value.response));
    event.waitUntil(result.then(value => value.stored));
  }
  // JSON is already cached by the app. Videos, streams and opaque responses
  // must not fill a second, unbounded media/API cache.
});

async function shellAsset(request) {
  const cached = await caches.open(shellCacheName).then(cache => cache.match(request)).catch(() => null);
  return cached || fetch(request);
}

async function navigate(request) {
  try {
    // Keep this build's precached index together with its matching hashed assets.
    // An online new index can load its own files; SW activation installs that build.
    return await fetch(request, { cache: 'no-cache' });
  } catch {
    const cached = await caches.open(shellCacheName).then(cache => cache.match(indexUrl)).catch(() => null);
    return cached || new Response('Offline. Open the app once online to save its shell.', { status: 503 });
  }
}

async function image(request) {
  const cached = await matchBoundedCache(imageCacheName, request, IMAGE_CACHE_POLICY);
  if (cached) return { response: cached };
  const response = await fetch(request);
  const stored = response.headers.get('content-type')?.startsWith('image/')
    ? putBoundedCache(imageCacheName, request, response.clone(), IMAGE_CACHE_POLICY)
    : Promise.resolve(false);
  return { response, stored };
}
