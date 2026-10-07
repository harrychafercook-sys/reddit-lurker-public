import { isTestInstance } from './cache-config.js';

export function createAppStorage(storage, pathname) {
  const prefix = isTestInstance(pathname) ? 'reddit-lurker-test:' : '';
  const settings = new Set(['favorites', 'redditClientId', 'redditSecret', 'rapidApiKey', 'displayZoom']);
  const ownedKey = (key) => prefix ? key.startsWith(prefix) :
    settings.has(key) || ['cachedFeed_', 'comment-', 'article_'].some((start) => key.startsWith(start));
  return {
    keys: () => Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key) => key !== null && ownedKey(key))
      .map((key) => key.slice(prefix.length)),
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
    clear() {
      // Never clear the whole origin: WordPress and other apps share it.
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      keys.filter((key) => key !== null && ownedKey(key)).forEach((key) => storage.removeItem(key));
    },
  };
}

export const appStorage = createAppStorage(globalThis.localStorage, globalThis.location?.pathname || '/');
