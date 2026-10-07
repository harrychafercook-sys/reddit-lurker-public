import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../android/assets/migrate-settings.js', import.meta.url), 'utf8');
const storage = entries => {
  const values = new Map(entries);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('Android migration copies only settings, keeping original credentials and cache untouched', () => {
  const original = storage([['redditClientId', 'test-id'], ['redditSecret', 'test-secret'],
    ['rapidApiKey', 'test-key'], ['favorites', '["pics"]'], ['displayZoom', '125'],
    ['comment-private', 'cached content'], ['unrelated', 'unrelated']]);
  const result = vm.runInNewContext(source, { localStorage: original }).read();
  assert.deepEqual(Object.keys(result).sort(), ['displayZoom', 'favorites', 'rapidApiKey', 'redditClientId', 'redditSecret']);
  assert.equal(result.redditSecret, 'test-secret');
  assert.equal(original.values.size, 7);
  const target = storage([['displayZoom', '90'], ['favorites', '["news"]'], ['unrelated', 'keep']]);
  const migrator = vm.runInNewContext(source, { localStorage: target });
  assert.equal(migrator.write(result), true);
  assert.equal(target.getItem('redditClientId'), 'test-id');
  assert.equal(target.getItem('favorites'), '["news"]');
  assert.equal(target.getItem('displayZoom'), '90');
  assert.equal(target.getItem('unrelated'), 'keep');
  assert.equal(migrator.write(result), true);
  assert.equal(target.values.size, 6);
});

test('Android migration can safely retry interrupted writes without marking them successful', () => {
  const target = storage([]);
  const write = target.setItem;
  target.setItem = (key, value) => {
    if (key === 'redditSecret') throw new Error('Quota exceeded');
    write(key, value);
  };
  const migrator = vm.runInNewContext(source, { localStorage: target });
  const settings = { redditClientId: 'test-id', redditSecret: 'test-secret', cachedFeed_popular: 'ignore' };
  assert.throws(() => migrator.write(settings), /Quota exceeded/);
  target.setItem = write;
  assert.equal(migrator.write(settings), true);
  assert.equal(target.values.size, 2);
  assert.equal(target.getItem('redditSecret'), 'test-secret');
});
