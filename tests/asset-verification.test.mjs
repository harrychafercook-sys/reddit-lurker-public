import test from 'node:test';
import assert from 'node:assert/strict';
import pngjs from 'pngjs';
import { verifyAssetBytes } from '../scripts/asset-verification.mjs';

test('code and HTML must match the release byte-for-byte', () => {
  assert.equal(verifyAssetBytes('index.html', Buffer.from('app'), Buffer.from('app')), 'hash');
  assert.throws(() => verifyAssetBytes('app.js', Buffer.from('app'), Buffer.from('changed')), /differs/);
});

test('lossless PNG recompression is accepted only with identical pixels', () => {
  const image = { width: 3, height: 2, data: Buffer.from([
    10, 20, 30, 255, 20, 30, 40, 255, 30, 40, 50, 255,
    40, 50, 60, 255, 50, 60, 70, 255, 60, 70, 80, 255,
  ]) };
  const original = pngjs.PNG.sync.write(image, { filterType: 0 });
  const recompressed = pngjs.PNG.sync.write(image, { filterType: 4 });
  assert.notDeepEqual(original, recompressed);
  assert.equal(verifyAssetBytes('icon.png', original, recompressed, 'image/png'), 'pixels');
  assert.throws(() => verifyAssetBytes('icon.png', original, recompressed, 'text/html'), /differs/);
});

test('modified image pixels fail release verification', () => {
  const original = pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([0, 0, 0, 255]) });
  const modified = pngjs.PNG.sync.write({ width: 1, height: 1, data: Buffer.from([1, 0, 0, 255]) });
  assert.throws(() => verifyAssetBytes('icon.png', original, modified, 'image/png'), /differs/);
});
