import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectStore, type ChangeEvent } from '../src/store.js';
import { exampleCopy } from './helpers.js';

/** Writes like `writeProjectToFolder` and `sbd mcp` do: a temp file renamed over the target. */
function atomicWrite(file: string, text: string) {
  const tmp = join(file, '..', `.${Date.now()}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

describe('ProjectStore watcher (changes from other processes)', () => {
  let cleanup: (() => void) | undefined;
  let store: ProjectStore | undefined;
  afterEach(() => {
    store?.stopWatching();
    cleanup?.();
  });

  // 'per-directory' is the default off macOS/Windows (and works there too); 'native' recursive
  // watching misses repeated replaces on Linux with Node <= 22, so it only runs where it is used.
  const nativeOk = process.platform === 'darwin' || process.platform === 'win32';
  for (const mode of ['native', 'per-directory'] as const) {
    it.skipIf(mode === 'native' && !nativeOk)(
      `${mode}: reports every replace of the same file, in subfolders and new folders`,
      async () => {
        const ex = exampleCopy();
        cleanup = ex.cleanup;
        store = ProjectStore.open(ex.dir);
        const events: ChangeEvent[] = [];
        store.on('change', (e) => events.push(e));
        store.startWatching(30, mode);
        await new Promise((r) => setTimeout(r, 100));
        const next = async (write: () => void, file: string) => {
          const n = events.length;
          write();
          await expect
            .poll(() => events.slice(n).some((e) => e.files.includes(file)), { timeout: 3000 })
            .toBe(true);
        };
        const shot = join(ex.dir, 'shots/opening.json');
        for (const title of ['One', 'Two', 'Three']) {
          await next(
            () => atomicWrite(shot, JSON.stringify({ id: 'opening', title })),
            'shots/opening.json',
          );
        }
        await next(() => atomicWrite(join(ex.dir, 'script.fountain'), 'A\n'), 'script.fountain');
        await next(() => atomicWrite(join(ex.dir, 'script.fountain'), 'B\n'), 'script.fountain');
        mkdirSync(join(ex.dir, 'extra/deep'), { recursive: true });
        await next(
          () => writeFileSync(join(ex.dir, 'extra/deep/a.json'), '{}'),
          'extra/deep/a.json',
        );
        await next(() => atomicWrite(join(ex.dir, 'extra/deep/a.json'), '[]'), 'extra/deep/a.json');
        // temp files (dot names) are never reported
        expect(events.flatMap((e) => e.files).some((f) => f.includes('.tmp'))).toBe(false);
      },
    );
  }
});
