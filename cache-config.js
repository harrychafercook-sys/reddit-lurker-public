export function isTestInstance(pathname) {
  return pathname === '/rlurker-test' || pathname.startsWith('/rlurker-test/');
}

// Keep production downloads, and isolate the test deployment on the same origin.
export function getPostCacheName(pathname) {
  return isTestInstance(pathname)
    ? 'reddit-lurker-test-posts-v1'
    : 'reddit-lurker-cache-v7.1.0';
}

export const POST_CACHE_NAME = getPostCacheName(globalThis.location?.pathname || '/');

export const POST_CACHE_POLICY = {
  maxEntries: 100, maxBytes: 2 * 1024 * 1024, maxEntryBytes: 64 * 1024,
  maxAge: 7 * 24 * 60 * 60 * 1000, migrateLegacy: true,
};
export const IMAGE_CACHE_POLICY = {
  maxEntries: 100, maxBytes: 20 * 1024 * 1024, maxEntryBytes: 1024 * 1024,
  maxAge: 48 * 60 * 60 * 1000,
};
export function getImageCacheName(scopePath) {
  return 'reddit-lurker-images-v1-' + encodeURIComponent(scopePath);
}
export function obsoleteContentCaches(names, scopePath) {
  const legacy = isTestInstance(scopePath) ? [] : ['reddit-lurker-cache-v7.0.9', 'reddit-lurker-cache-v7.1.3'];
  return names.filter((name) => legacy.includes(name) ||
    name === 'reddit-lurker-runtime-' + encodeURIComponent(scopePath));
}
