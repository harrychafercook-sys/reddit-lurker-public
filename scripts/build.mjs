import { build, transform } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, lstat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const read = (name) => readFile(join(root, name));
const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);
const assets = [
  'manifest.json', 'site.webmanifest', 'apple-touch-icon.png',
  'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png',
  'icons/icon-circular-192x192.png', 'icons/icon-circular-512x512.png',
];

const app = await build({
  absWorkingDir: root,
  entryPoints: ['app.js'],
  bundle: true,
  write: false,
  minify: true,
  loader: { '.js': 'jsx' },
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'inline',
});
const stylesheet = await postcss([tailwindcss({
  content: [join(root, 'app.js'), join(root, 'zoomable-image.js'), join(root, 'index.html')],
})]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' +
  await readFile(join(root, 'style.css'), 'utf8'), { from: undefined });
const css = await transform(stylesheet.css, { loader: 'css', minify: true });
const appName = 'assets/app.' + hash(app.outputFiles[0].contents) + '.js';
const cssName = 'assets/styles.' + hash(css.code) + '.css';
const html = (await readFile(join(root, 'index.html'), 'utf8'))
  .replace('{{BUNDLE}}', './' + appName)
  .replace('{{STYLESHEET}}', './' + cssName);
const files = new Map([
  [appName, app.outputFiles[0].contents], [cssName, css.code], ['index.html', html],
  ['.nojekyll', ''],
]);
for (const asset of assets) files.set(asset, await read(asset));
files.set('api/resolve-video.php', await read('api/resolve-video.php'));
files.set('api/fetch-image.php', await read('api/fetch-image.php'));

// Include shell, icons and worker source so every deployment change updates the SW.
const version = createHash('sha256');
for (const [name, contents] of files) version.update(name).update(contents);
version.update(await read('sw.js')).update(await read('cache-config.js'));
const buildId = version.digest('hex').slice(0, 16);
const precache = ['./', ...[...files.keys()].filter((name) => name !== '.nojekyll' && !name.endsWith('.php'))
  .map((name) => './' + name)];
const worker = await build({
  absWorkingDir: root,
  entryPoints: ['sw.js'],
  bundle: true,
  write: false,
  target: ['es2020'],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __PRECACHE__: JSON.stringify(precache),
  },
});
files.set('sw.js', worker.outputFiles[0].contents);

// This script only replaces the generated dist directory inside this project.
if (dirname(output) !== root || output !== resolve(root, 'dist')) {
  throw new Error('Invalid build output path');
}
const outputInfo = await lstat(output).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
if (outputInfo?.isSymbolicLink()) throw new Error('Refusing to replace a linked dist directory');
await rm(output, { recursive: true, force: true });
for (const [name, contents] of files) {
  const destination = join(output, name);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}
console.log('Built ' + files.size + ' files in dist (build ' + buildId + ').');
