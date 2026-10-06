// Serves the built web app (apps/web/dist) as a plain static site, like the hosted copy on
// Cloudflare Workers: no `sbd serve` API. Page navigations fall back to index.html; any other
// unknown path (such as /api/…) is a 404, so a stray API request shows up in the tests.
// Usage: node e2e/static.mjs <port>
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
if (!existsSync(join(root, 'index.html'))) {
  console.error('Build first: pnpm build');
  process.exit(1);
}
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
const port = Number(process.argv[2] ?? 4473);
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
  const found = file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile();
  if (!found) {
    if (req.headers['sec-fetch-mode'] !== 'navigate') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    file = join(root, 'index.html');
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`static app on http://localhost:${port}`));
