const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
export const DATA_CACHE_LIMIT = 2 * MB;
export const MAX_FEED_POSTS = 100;
export const isContentKey = (key) => ['cachedFeed_', 'comment-', 'article_'].some((prefix) => key.startsWith(prefix));
const lifetime = (key) => key.startsWith('article_') ? 7 * 24 * HOUR : 48 * HOUR;

export function limitFeed(data) {
  const seen = new Set();
  const unique = data.threads.filter((post) => !seen.has(post.id) && seen.add(post.id));
  return { ...data, threads: unique.slice(0, MAX_FEED_POSTS),
    after: unique.length > MAX_FEED_POSTS ? null : data.after };
}

export function createDataCache(storage, {
  maxBytes = DATA_CACHE_LIMIT, maxEntries = 120, maxEntryBytes = 800 * 1024,
  maxFeeds = 3, now = Date.now, online = () => globalThis.navigator?.onLine !== false,
} = {}) {
  const size = (key, value) => 2 * (key.length + value.length + 64);
  function records() {
    return storage.keys().filter(isContentKey).flatMap((key) => {
      try {
        const raw = storage.getItem(key);
        const item = JSON.parse(raw);
        if (!item || !Number.isFinite(item.timestamp) || !('data' in item)) throw new Error('Invalid cache entry');
        return [{ key, bytes: size(key, raw), timestamp: item.timestamp }];
      } catch {
        storage.removeItem(key);
        return [];
      }
    }).sort((a, b) => a.timestamp - b.timestamp);
  }
  function prune() {
    let entries = records();
    const removed = new Set();
    for (const entry of entries) {
      if (entry.bytes > maxEntryBytes || (online() && now() - entry.timestamp > lifetime(entry.key))) {
        storage.removeItem(entry.key);
        removed.add(entry.key);
      }
    }
    entries = entries.filter((entry) => !removed.has(entry.key));
    const feeds = entries.filter((entry) => entry.key.startsWith('cachedFeed_'));
    for (const entry of feeds.slice(0, Math.max(0, feeds.length - maxFeeds))) {
      storage.removeItem(entry.key);
      removed.add(entry.key);
    }
    entries = entries.filter((entry) => !removed.has(entry.key));
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    while (entries.length && (bytes > maxBytes || entries.length > maxEntries)) {
      const oldest = entries.shift();
      storage.removeItem(oldest.key);
      bytes -= oldest.bytes;
    }
    return { bytes, count: entries.length, limit: maxBytes };
  }
  function get(key) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (!item || !('data' in item)) return null;
      if (isContentKey(key) && online() && (!Number.isFinite(item.timestamp) || now() - item.timestamp > lifetime(key))) {
        storage.removeItem(key);
        return null;
      }
      return item.data;
    } catch {
      if (isContentKey(key)) storage.removeItem(key);
      return null;
    }
  }
  function set(key, data) {
    const value = key.startsWith('cachedFeed_') ? limitFeed(data) : data;
    let raw;
    try { raw = JSON.stringify({ timestamp: now(), data: value }); } catch { return false; }
    if (isContentKey(key) && size(key, raw) > Math.min(maxBytes, maxEntryBytes)) return false;
    prune();
    let entries = records().filter((entry) => entry.key !== key);
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const newBytes = isContentKey(key) ? size(key, raw) : 0;
    while (entries.length && (bytes + newBytes > maxBytes || entries.length >= maxEntries)) {
      const oldest = entries.shift();
      storage.removeItem(oldest.key);
      bytes -= oldest.bytes;
    }
    // Other apps or the browser may leave less room than our own budget.
    // Discard only our oldest content and retry; never fail a successful API fetch.
    for (;;) {
      try {
        storage.setItem(key, raw);
        prune();
        return storage.getItem(key) === raw;
      } catch {
        if (!entries.length) return false;
        storage.removeItem(entries.shift().key);
      }
    }
  }
  return { get, set, prune, stats: prune,
    clear: () => storage.keys().filter(isContentKey).forEach((key) => storage.removeItem(key)) };
}
