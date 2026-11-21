import { build } from 'vite';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const output = path.join(root, '.vercel', 'output');
const staticDir = path.join(output, 'static');

console.log('[vercel-package] Project root:', root);
await build({ root, build: { outDir: dist, emptyOutDir: true } });
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('<div id="root">')) {
  throw new Error('Missing React entry point in dist/index.html');
}
await mkdir(staticDir, { recursive: true });
await cp(dist, staticDir, { recursive: true, force: true });
await writeFile(path.join(output, 'config.json'), JSON.stringify({ version: 3 }, null, 2) + '\n');
console.log('[vercel-package] Ready:', path.join(staticDir, 'index.html'));
