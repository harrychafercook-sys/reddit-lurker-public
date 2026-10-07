import { createHash } from 'node:crypto';
import pngjs from 'pngjs';

export function verifyAssetBytes(name, expected, actual, contentType = '') {
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  if (digest(actual) === digest(expected)) return 'hash';
  // Hostinger recompresses PNGs and rewrites metadata. Require identical RGBA pixels.
  if (name.endsWith('.png') && contentType.split(';')[0] === 'image/png') {
    const original = pngjs.PNG.sync.read(expected);
    const delivered = pngjs.PNG.sync.read(actual);
    if (original.width === delivered.width && original.height === delivered.height &&
        original.data.equals(delivered.data)) return 'pixels';
  }
  throw new Error('Public content differs from the release: ' + name);
}
