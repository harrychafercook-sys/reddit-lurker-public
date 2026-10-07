import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
async function client(controlled, native = false) {
  const handlers = {};
  let reloads = 0, updates = 0, poll;
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => { handlers[name] = fn; } };
  vm.runInNewContext(script, {
    document, console,
    window: {
      __REDDIT_LURKER_NATIVE__: native,
      addEventListener: (name, fn) => { handlers[name] = fn; },
      location: { reload: () => { reloads++; } },
      setInterval: (fn, interval) => { assert.equal(interval, 60000); poll = fn; },
    },
    navigator: { serviceWorker: {
      controller: controlled ? {} : null,
      addEventListener: (name, fn) => { handlers[name] = fn; },
      register: async () => ({ update: async () => { updates++; } }),
    } },
  });
  handlers.load?.();
  await Promise.resolve();
  return { handlers, document, poll: () => poll(), get reloads() { return reloads; }, get updates() { return updates; } };
}

test('a fresh installation refreshes when a later deployment takes over, without a reload loop', async () => {
  const page = await client(false);
  page.handlers.controllerchange();
  assert.equal(page.reloads, 0);
  page.handlers.controllerchange();
  assert.equal(page.reloads, 1);
  page.handlers.controllerchange();
  assert.equal(page.reloads, 1);
  const returning = await client(true);
  returning.handlers.controllerchange();
  assert.equal(returning.reloads, 1);
});

test('the packaged Android app never registers or polls the hosted service worker', async () => {
  const page = await client(true, true);
  assert.equal(page.handlers.load, undefined);
  assert.equal(page.handlers.controllerchange, undefined);
  assert.equal(page.handlers.visibilitychange, undefined);
  assert.equal(page.updates, 0);
  assert.equal(page.reloads, 0);
});

test('visible sessions and resumed apps check for deployments; hidden sessions do not poll', async () => {
  const page = await client(true);
  page.poll();
  assert.equal(page.updates, 1);
  page.document.visibilityState = 'hidden';
  page.poll();
  page.handlers.visibilitychange();
  assert.equal(page.updates, 1);
  page.document.visibilityState = 'visible';
  page.handlers.visibilitychange();
  assert.equal(page.updates, 2);
});
