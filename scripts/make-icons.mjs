// Generates the PWA PNG icons (192, 512, maskable 512) into apps/web/public.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster } from './lib/raster.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '../apps/web/public');

function roundRect(r, x, y, w, h, rad, color) {
  r.rect(x + rad, y, w - 2 * rad, h, color);
  r.rect(x, y + rad, rad, h - 2 * rad, color);
  r.rect(x + w - rad, y + rad, rad, h - 2 * rad, color);
  for (const [cx, cy] of [
    [x + rad, y + rad],
    [x + w - rad, y + rad],
    [x + rad, y + h - rad],
    [x + w - rad, y + h - rad],
  ])
    r.circle(cx, cy, rad, color);
}

function icon(size, maskable) {
  const r = new Raster(size, size, maskable ? '#1b1e24' : null);
  const s = size / 24;
  const pad = maskable ? size * 0.2 : 0;
  const k = (size - 2 * pad) / size;
  const X = (v) => pad + v * s * k;
  if (!maskable) roundRect(r, 0, 0, size, size, size * 0.2, '#1b1e24');
  roundRect(r, X(4), X(6), 16 * s * k, 12 * s * k, 2 * s * k, '#f0b04a');
  roundRect(r, X(6.5), X(8.5), 5 * s * k, 4 * s * k, 0.8 * s * k, '#1b1e24');
  roundRect(r, X(12.5), X(8.5), 5 * s * k, 4 * s * k, 0.8 * s * k, '#7a5c22');
  roundRect(r, X(6.5), X(14), 11 * s * k, 1.8 * s * k, 0.9 * s * k, '#7a5c22');
  return r.png();
}

writeFileSync(join(out, 'icon-192.png'), icon(192, false));
writeFileSync(join(out, 'icon-512.png'), icon(512, false));
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, true));
console.log('wrote icons');
