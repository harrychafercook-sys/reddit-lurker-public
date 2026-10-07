import test from 'node:test';
import assert from 'node:assert/strict';
import { fitImage, pinchImage, clampImage } from '../image-transform.js';

test('pinching preserves the image point under the fingers while the midpoint moves', () => {
  const start = { scale: 2, x: -40, y: 30 };
  const anchor = { x: 60, y: 50 };
  const midpoint = { x: 70, y: 80 };
  const result = pinchImage(start, anchor, midpoint, 1.5);
  assert.equal(result.scale, 3);
  assert.equal((midpoint.x - result.x) / result.scale, (anchor.x - start.x) / start.scale);
  assert.equal((midpoint.y - result.y) / result.scale, (anchor.y - start.y) / start.scale);
});
test('panning stays inside the image edges, and zooming out returns to the fitted image', () => {
  const image = { width: 300, height: 200 }, viewport = { width: 300, height: 400 };
  assert.deepEqual(clampImage({ scale: 3, x: 900, y: -900 }, image, viewport), { scale: 3, x: 300, y: -100 });
  assert.deepEqual(clampImage({ scale: .2, x: 300, y: -100 }, image, viewport), fitImage());
  assert.equal(pinchImage(fitImage(), { x: 0, y: 0 }, { x: 0, y: 0 }, 100).scale, 5);
});
