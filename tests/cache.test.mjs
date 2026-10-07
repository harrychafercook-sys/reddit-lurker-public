import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataCache, limitFeed } from '../data-cache.js';
import { putBoundedCache, pruneBoundedCache, clearBoundedCache } from '../bounded-cache.js';
import { obsoleteContentCaches } from '../cache-config.js';

function storage(quota = Infinity) {
  const values = new Map();
  return { values, keys: () => [...values.keys()], getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      const others = [...values].filter(([stored]) => stored !== key).reduce((sum, [k, v]) => sum + 2 * (k.length + v.length), 0);
      if (others + 2 * (key.length + value.length) > quota) throw new DOMException('Full', 'QuotaExceededError');
      values.set(key, value);
    } };
}

test('cache quota pressure evicts content and keeps credentials, favourites and other apps', () => {
  const store = storage(1300);
  store.setItem('redditClientId', 'private-setting');
  store.setItem('other-app', 'keep');
  const cache = createDataCache(store, { maxBytes: 10000 });
  assert.equal(cache.set('favorites', ['pics']), true);
  for (let index = 0; index < 30; index++) assert.equal(cache.set('comment-' + index, 'x'.repeat(250)), true);
  assert.ok(store.keys().filter(key => key.startsWith('comment-')).length < 3);
  assert.equal(cache.get('comment-29'), 'x'.repeat(250));
  cache.clear();
  assert.equal(store.getItem('redditClientId'), 'private-setting');
  assert.deepEqual(cache.get('favorites'), ['pics']);
  assert.equal(store.getItem('other-app'), 'keep');
});

test('a completely full storage area skips caching without failing a fetched result', () => {
  const cache = createDataCache(storage(0));
  assert.equal(cache.set('comment-new', ['successfully fetched']), false);
});

test('size, count and feed limits remain bounded through long browsing sessions', () => {
  let clock = 100;
  const store = storage();
  const cache = createDataCache(store, { maxBytes: 5000, maxEntries: 6, now: () => clock++ });
  for (let index = 0; index < 100; index++) cache.set('comment-' + index, 'x'.repeat(200));
  assert.ok(cache.stats().bytes <= 5000);
  assert.ok(cache.stats().count <= 6);
  for (let index = 0; index < 20; index++) cache.set('cachedFeed_' + index, { threads: [{ id: 'one' }], after: 'cursor' });
  assert.equal(store.keys().filter(key => key.startsWith('cachedFeed_')).length, 3);
  const feed = limitFeed({ threads: Array.from({ length: 400 }, (_, i) => ({ id: String(i % 150) })), after: 'last-page' });
  assert.equal(feed.threads.length, 100);
  assert.equal(feed.after, null);
});

test('oversized downloads do not evict useful entries', () => {
  const cache = createDataCache(storage(), { maxEntryBytes: 1000 });
  cache.set('comment-small', ['keep']);
  assert.equal(cache.set('article_huge', 'x'.repeat(2000)), false);
  assert.deepEqual(cache.get('comment-small'), ['keep']);
});

test('startup sweeps expired and malformed data, preserving offline reading', () => {
  let clock = 1000;
  let online = false;
  const store = storage();
  const cache = createDataCache(store, { now: () => clock, online: () => online });
  cache.set('comment-old', ['offline']);
  cache.set('favorites', ['all']);
  store.setItem('article_bad', '{broken');
  clock += 8 * 24 * 60 * 60 * 1000;
  cache.prune();
  assert.deepEqual(cache.get('comment-old'), ['offline']);
  assert.equal(store.getItem('article_bad'), null);
  online = true;
  cache.prune();
  assert.equal(cache.get('comment-old'), null);
  assert.deepEqual(cache.get('favorites'), ['all']);
});

function cacheStorage(quota = Infinity) {
  const stores = new Map();
  const key = request => new URL(typeof request === 'string' ? request : request.url, 'https://app.test/').href;
  return { stores, async delete(name) { return stores.delete(name); }, async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return { async keys() { return [...entries.keys()].map(url => new Request(url)); },
      async match(request) { return entries.get(key(request))?.clone(); },
      async delete(request) { return entries.delete(key(request)); },
      async put(request, response) {
        const bytes = await response.clone().arrayBuffer();
        let total = bytes.byteLength;
        for (const [url, stored] of entries) if (url !== key(request)) total += (await stored.clone().arrayBuffer()).byteLength;
        if (total > quota) throw new DOMException('Full', 'QuotaExceededError');
        entries.set(key(request), response.clone());
      } };
  } };
}
const policy = { maxBytes: 250, maxEntries: 3, maxEntryBytes: 100, maxAge: 100000 };

test('parallel media downloads obey both the byte and entry budgets', async () => {
  const storage = cacheStorage();
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => putBoundedCache('media', 'image-' + i, new Response('x'.repeat(100)), policy, storage)));
  assert.ok(results.every(Boolean));
  const entries = storage.stores.get('media');
  assert.equal(entries.size, 2);
  assert.ok(entries.has('https://app.test/image-39'));
  assert.equal(await putBoundedCache('media', 'too-big', new Response('x'.repeat(101)), policy, storage), false);
  assert.equal(entries.size, 2);
  await clearBoundedCache('media', storage);
  assert.equal(storage.stores.has('media'), false);
});

test('CacheStorage quota failures retry after eviction and never reject browsing', async () => {
  const storage = cacheStorage(100);
  assert.equal(await putBoundedCache('media', 'first', new Response('x'.repeat(100)), policy, storage), true);
  assert.equal(await putBoundedCache('media', 'second', new Response('y'.repeat(100)), policy, storage), true);
  assert.equal(storage.stores.get('media').size, 1);
  assert.equal(await putBoundedCache('none', 'first', new Response('x'), policy, cacheStorage(0)), false);
});

test('legacy cache migration removes media and bounds old post copies', async () => {
  const storage = cacheStorage();
  const cache = await storage.open('posts');
  for (let index = 0; index < 10; index++) await cache.put('post-' + index, new Response('x'.repeat(100)));
  await cache.put('old-video.mp4', new Response('x'.repeat(1000)));
  await pruneBoundedCache('posts', { ...policy, migrateLegacy: true }, storage);
  assert.equal((await cache.keys()).length, 2);
  assert.equal(await cache.match('old-video.mp4'), undefined);
  for (const request of await cache.keys()) assert.ok((await cache.match(request)).headers.has('X-Lurker-Bytes'));
});

test('test deployment cleanup does not remove production downloads', () => {
  const names = ['reddit-lurker-cache-v7.1.0', 'reddit-lurker-cache-v7.1.3', 'reddit-lurker-runtime-%2Frlurker-test%2F', 'other-app'];
  assert.deepEqual(obsoleteContentCaches(names, '/rlurker-test/'), ['reddit-lurker-runtime-%2Frlurker-test%2F']);
});
