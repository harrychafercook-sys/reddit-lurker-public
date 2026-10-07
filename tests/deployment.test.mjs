import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const scope = 'https://example.test/reddit-lurker/';
const shellPrefix = 'reddit-lurker-shell-%2Freddit-lurker%2F-';
const workerSource = await readFile(resolve(dist, 'sw.js'), 'utf8');
const html = await readFile(resolve(dist, 'index.html'), 'utf8');

function worker({ offline = false, failInstall = false, status = 200 } = {}) {
  const events = {};
  const stores = new Map();
  const networkOptions = [];
  let skipped = false;
  let claimed = false;
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, response) { entries.set(key(request), response.clone()); },
        async keys() { return [...entries.keys()].map(url => new Request(url)); },
        async delete(request) { return entries.delete(key(request)); },
        async addAll(urls) {
          if (failInstall) throw new Error('Network failed during installation');
          for (const url of urls) {
            const path = new URL(url, scope).pathname.slice('/reddit-lurker/'.length) || 'index.html';
            entries.set(key(url), new Response(await readFile(resolve(dist, path))));
          }
        },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  vm.runInNewContext(workerSource, {
    URL, Response, Request, Headers, Uint8Array, caches,
    fetch: async (request, options) => {
      if (offline) throw new Error('Offline');
      networkOptions.push(options);
      return new Response('fresh response', { status });
    },
    self: {
      registration: { scope },
      clients: { claim: async () => { claimed = true; } },
      skipWaiting: async () => { skipped = true; },
      addEventListener: (type, handler) => { events[type] = handler; },
    },
  });
  return {
    stores, caches, networkOptions,
    get skipped() { return skipped; },
    get claimed() { return claimed; },
    async lifecycle(type) {
      let pending;
      events[type]({ waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
    fetch(url, { method = 'GET', mode = 'cors', range = false, destination = '' } = {}) {
      let pending;
      events.fetch({
        request: { url, method, mode, destination, headers: new Headers(range ? { range: 'bytes=0-9' } : {}) },
        waitUntil: promise => promise.catch(() => {}),
        respondWith: (promise) => { pending = promise; },
      });
      return pending;
    },
  };
}

test('deployment contains local, resolvable assets and no source directories', async () => {
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
  assert.doesNotMatch(html, /\{\{[A-Z]+\}\}/);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    await readFile(resolve(dist, match[1]));
  }
  const entries = await readdir(dist);
  for (const excluded of ['backups', 'node_modules', 'app.js', 'package.json']) {
    assert.ok(!entries.includes(excluded));
  }
});

test('subfolder install precaches every asset and only activates after success', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.equal(sw.skipped, true);
  const shell = [...sw.stores].find(([name]) => name.startsWith(shellPrefix))[1];
  assert.equal(await shell.get(scope + 'index.html').text(), html);
  assert.ok([...shell.keys()].every((url) => url.startsWith(scope)));
  const failed = worker({ failInstall: true });
  await assert.rejects(failed.lifecycle('install'), /Network failed/);
  assert.equal(failed.skipped, false);
});

test('updates preserve saved posts and caches owned by other apps or scopes', async () => {
  const sw = worker();
  await sw.caches.open(shellPrefix + 'old');
  await sw.caches.open('reddit-lurker-cache-v7.1.0');
  await sw.caches.open('other-app-cache');
  await sw.caches.open('reddit-lurker-shell-%2Fother%2F-old');
  await sw.lifecycle('install');
  await sw.lifecycle('activate');
  assert.equal(sw.stores.has(shellPrefix + 'old'), false);
  for (const retained of ['reddit-lurker-cache-v7.1.0', 'other-app-cache', 'reddit-lurker-shell-%2Fother%2F-old']) {
    assert.equal(sw.stores.has(retained), true);
  }
  assert.equal(sw.claimed, true);
});

test('offline navigation loads the cached shell, including a new query string', async () => {
  const sw = worker({ offline: true });
  await sw.lifecycle('install');
  const response = await sw.fetch(scope + '?launch=offline', { mode: 'navigate' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), html);
  const script = html.match(/<script src="([^"]+)"/)[1];
  const asset = await sw.fetch(new URL(script, scope).href);
  assert.equal(asset.status, 200);
});

test('API responses have one app-managed cache, even when offline', async () => {
  const sw = worker({ offline: true });
  assert.equal(sw.fetch('https://oauth.reddit.com/r/popular/hot'), undefined);
  assert.equal(sw.fetch('https://article-extractor2.p.rapidapi.com/article/proxy/parse?url=test'), undefined);
  assert.equal(sw.stores.size, 0);
});

test('navigation checks the network and HTTP auth errors remain visible', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  const response = await sw.fetch(scope, { mode: 'navigate' });
  assert.equal(await response.text(), 'fresh response');
  assert.equal(sw.networkOptions[0].cache, 'no-cache');
  const unauthorized = worker({ status: 401 });
  const result = await unauthorized.fetch(scope, { mode: 'navigate' });
  assert.equal(result.status, 401);
});

test('the service worker leaves writes, video ranges and unrelated apps alone', () => {
  const sw = worker();
  assert.equal(sw.fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST' }), undefined);
  assert.equal(sw.fetch('https://v.redd.it/video/DASH.mp4', { range: true }), undefined);
  assert.equal(sw.fetch('https://v.redd.it/video/DASH.mp4', { destination: 'video' }), undefined);
  assert.equal(sw.fetch('https://v.redd.it/video/HLS.m3u8'), undefined);
  assert.equal(sw.fetch(scope + 'unknown-file?random=1'), undefined);
  assert.equal(sw.fetch(scope + 'api/resolve-video.php'), undefined);
  assert.equal(sw.fetch(scope + 'api/resolve-video.php?provider=streamff&id=abc'), undefined);
  assert.equal(sw.fetch('https://example.test/another-app/'), undefined);
  assert.equal(sw.fetch('https://unrelated.example/'), undefined);
});

test('navigation query strings cannot grow the shell cache', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  const shell = [...sw.stores.values()][0];
  const before = shell.size;
  for (let index = 0; index < 50; index++) await sw.fetch(scope + '?v=' + index, { mode: 'navigate' });
  assert.equal(shell.size, before);
  assert.equal(await shell.get(scope + 'index.html').text(), html);
});

test('activation deletes the old unlimited runtime and legacy content caches', async () => {
  const sw = worker();
  for (const name of ['reddit-lurker-runtime-%2Freddit-lurker%2F', 'reddit-lurker-cache-v7.1.3']) await sw.caches.open(name);
  await sw.lifecycle('activate');
  assert.equal(sw.stores.has('reddit-lurker-runtime-%2Freddit-lurker%2F'), false);
  assert.equal(sw.stores.has('reddit-lurker-cache-v7.1.3'), false);
});
