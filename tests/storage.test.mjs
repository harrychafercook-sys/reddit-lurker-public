import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppStorage } from '../storage.js';
import { getPostCacheName } from '../cache-config.js';

function memoryStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

test('test deployment cannot read or overwrite live credentials and favorites', () => {
  const backing = memoryStorage({ redditSecret: 'live-secret', favorites: 'live-favorites' });
  const staging = createAppStorage(backing, '/rlurker-test/');
  assert.equal(staging.getItem('redditSecret'), null);
  staging.setItem('redditSecret', 'test-secret');
  staging.setItem('favorites', 'test-favorites');
  staging.removeItem('redditSecret');
  assert.equal(backing.getItem('redditSecret'), 'live-secret');
  assert.equal(backing.getItem('favorites'), 'live-favorites');
  assert.equal(staging.getItem('favorites'), 'test-favorites');
});

test('clearing test data preserves live data and unrelated applications', () => {
  const backing = memoryStorage({ favorites: 'live', wordpress: 'keep' });
  const staging = createAppStorage(backing, '/rlurker-test/');
  staging.setItem('favorites', 'test');
  staging.setItem('comment-example', 'cached');
  staging.clear();
  assert.equal(backing.length, 2);
  assert.equal(backing.getItem('favorites'), 'live');
  assert.equal(backing.getItem('wordpress'), 'keep');
});

test('clearing live app data preserves the test app and unrelated applications', () => {
  const backing = memoryStorage({
    favorites: 'live', cachedFeed_popular_hot: 'cached',
    wordpress: 'keep', 'reddit-lurker-test:favorites': 'test',
  });
  createAppStorage(backing, '/rlurker/').clear();
  assert.equal(backing.getItem('favorites'), null);
  assert.equal(backing.getItem('cachedFeed_popular_hot'), null);
  assert.equal(backing.getItem('wordpress'), 'keep');
  assert.equal(backing.getItem('reddit-lurker-test:favorites'), 'test');
});

test('offline post caches differ between live app, test app and test worker', () => {
  assert.equal(getPostCacheName('/rlurker/'), 'reddit-lurker-cache-v7.1.0');
  assert.equal(getPostCacheName('/rlurker-test/'), 'reddit-lurker-test-posts-v1');
  assert.equal(getPostCacheName('/rlurker-test/sw.js'), 'reddit-lurker-test-posts-v1');
});
