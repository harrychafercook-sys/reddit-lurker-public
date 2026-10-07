import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyAssetBytes } from './asset-verification.mjs';

const [directory, origin] = process.argv.slice(2);
if (!directory || !origin) throw new Error('Usage: node scripts/verify-hostinger.mjs PAYLOAD_DIRECTORY TEST_URL');
const root = resolve(directory);
const base = new URL(origin);
if (base.protocol !== 'https:' || !base.pathname.endsWith('/')) {
  throw new Error('Provide an HTTPS deployment URL ending with /');
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entries = await readdir(root, { recursive: true, withFileTypes: true });
let checked = 0;
let recompressedImages = 0;
for (const entry of entries) {
  if (!entry.isFile() || entry.name.startsWith('.')) continue;
  const file = resolve(entry.parentPath || entry.path, entry.name);
  const name = relative(root, file).replaceAll('\\', '/');
  const response = await fetch(new URL(name, base), {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
  if (name === 'api/resolve-video.php' || name === 'api/fetch-image.php') {
    const status = await response.json();
    const service = name === 'api/fetch-image.php' ? 'reddit-lurker-images' : 'reddit-lurker-clips';
    if (status.service !== service || status.version !== 1 ||
        !response.headers.get('cache-control')?.includes('no-store')) {
      throw new Error(name + ' is not running correctly');
    }
    // Source integrity is checked over SSH by manifest.sha256 before activation.
    checked++;
    continue;
  }
  const verification = verifyAssetBytes(name, await readFile(file),
    Buffer.from(await response.arrayBuffer()), response.headers.get('content-type') || '');
  if (verification === 'pixels') recompressedImages++;
  if (['index.html', 'sw.js'].includes(name) && !response.headers.get('cache-control')?.includes('no-cache')) {
    throw new Error('Missing revalidation header for ' + name);
  }
  checked++;
}
const index = await fetch(base, { signal: AbortSignal.timeout(30000) });
if (!index.ok || digest(Buffer.from(await index.arrayBuffer())) !== digest(await readFile(resolve(root, 'index.html')))) {
  throw new Error('The deployment root does not serve this release');
}
if (!index.headers.get('x-robots-tag')?.includes('noindex')) throw new Error('Missing test-site noindex header');
console.log('Verified HTTPS root, cache headers, noindex, and ' + checked + ' public files (' +
  recompressedImages + ' CDN-recompressed PNGs verified pixel-for-pixel).');
