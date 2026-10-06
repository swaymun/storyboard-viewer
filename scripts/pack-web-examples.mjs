// Packs a few examples into apps/web/public/examples/*.sbd for the app's "Try an example" buttons
// (used by the hosted copy, where there is no `sbd serve`). Takes the COMMITTED version of each
// example (git archive HEAD), so local edits in examples/ never end up in the app.
// Run after `pnpm build`: `pnpm examples:web`. Keep the list in sync with apps/web/src/lib/examples.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXAMPLES = ['cat-crimes', 'pips-kite'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'packages/cli/dist/cli.js');
const out = join(root, 'apps/web/public/examples');
const tmp = mkdtempSync(join(tmpdir(), 'sbd-web-examples-'));
mkdirSync(out, { recursive: true });

try {
  let total = 0;
  for (const name of EXAMPLES) {
    const tar = join(tmp, `${name}.tar`);
    execFileSync('git', ['archive', '-o', tar, 'HEAD', `examples/${name}.sbd`], { cwd: root });
    execFileSync('tar', ['-xf', tar, '-C', tmp]);
    const file = join(out, `${name}.sbd`);
    execFileSync(
      process.execPath,
      [cli, 'pack', join(tmp, 'examples', `${name}.sbd`), '-o', file, '--force'],
      { stdio: 'inherit' },
    );
    total += statSync(file).size;
  }
  console.log(`${EXAMPLES.length} examples, ${(total / 1024 / 1024).toFixed(2)} MiB in ${out}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
