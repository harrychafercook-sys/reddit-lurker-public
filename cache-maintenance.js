import { POST_CACHE_NAME, POST_CACHE_POLICY, IMAGE_CACHE_POLICY, getImageCacheName, obsoleteContentCaches } from './cache-config.js';
import { pruneBoundedCache, clearBoundedCache } from './bounded-cache.js';

export async function maintainCaches({ clear = false } = {}) {
  if (!globalThis.caches || !globalThis.location) return;
  const scopePath = new URL('./', location.href).pathname;
  const imageCache = getImageCacheName(scopePath);
  const obsolete = obsoleteContentCaches(await caches.keys(), scopePath);
  await Promise.all(obsolete.map((name) => clearBoundedCache(name)));
  if (clear) {
    await Promise.all([clearBoundedCache(POST_CACHE_NAME), clearBoundedCache(imageCache)]);
  } else {
    await Promise.all([pruneBoundedCache(POST_CACHE_NAME, POST_CACHE_POLICY), pruneBoundedCache(imageCache, IMAGE_CACHE_POLICY)]);
  }
}
