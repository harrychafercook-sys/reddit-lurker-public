import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { imageFormat, MAX_IMAGE_BYTES } from '../image-export.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 4173);
const base = process.env.BASE_PATH || '/';
if (!base.startsWith('/') || !base.endsWith('/')) {
  throw new Error('BASE_PATH must start and end with /');
}
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.ico': 'image/x-icon',
};
await stat(resolve(root, 'index.html'));
createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end('Not found');
      return;
    }
    if (pathname === base + 'api/resolve-video.php' || pathname === base + 'api/fetch-image.php') {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      const imageRequest = pathname === base + 'api/fetch-image.php';
      // Run the same PHP resolver as Hostinger; never serve PHP source as text.
      const child = spawn(process.env.PHP_BINARY || 'php', [
        '-r', 'parse_str($argv[1], $_GET); require $argv[2];',
        url.search.slice(1), resolve(root, imageRequest ? 'api/fetch-image.php' : 'api/resolve-video.php'),
      ], { windowsHide: true });
      const chunks = [];
      let size = 0, failed = false;
      const timer = setTimeout(() => child.kill(), imageRequest ? 28000 : 15000);
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > (imageRequest ? MAX_IMAGE_BYTES : 8192)) { failed = true; child.kill(); }
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.on('error', () => { failed = true; });
      request.on('close', () => { if (!response.writableEnded) child.kill(); });
      child.on('close', code => {
        clearTimeout(timer);
        const body = Buffer.concat(chunks);
        if (imageRequest && !failed && code === 0 && body[0] !== 123) {
          try {
            const { mime } = imageFormat(body.subarray(0, 16));
            response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }).end(body);
            return;
          } catch { failed = true; }
        }
        let data;
        try { data = JSON.parse(body.toString()); } catch { data = { error: 'Local media helpers require PHP with curl and DOM. Set PHP_BINARY to its executable.' }; failed = true; }
        response.writeHead(failed || code !== 0 ? 503 : data.error ? 502 : 200, {
          'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        }).end(JSON.stringify(data));
      });
      return;
    }
    if (/\.php$/i.test(pathname)) { response.writeHead(404).end(); return; }
    const file = resolve(root, pathname.slice(base.length) || 'index.html');
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Preview: http://127.0.0.1:' + port + base);
});
