// Copies the built web app (apps/web/dist) into this package (web/) so `sbd serve` can ship it.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(pkg, '../../apps/web/dist');
const dest = join(pkg, 'web');
if (!existsSync(join(src, 'index.html'))) {
  console.warn('apps/web/dist not found: build @storyboard-viewer/web first (pnpm build)');
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copied web app into ${dest}`);
