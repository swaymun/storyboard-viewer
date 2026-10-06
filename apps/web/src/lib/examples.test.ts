import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples';

describe('bundled examples', () => {
  it('every example on the start screen is in public/examples (pnpm examples:web)', () => {
    let total = 0;
    for (const e of EXAMPLES) {
      const path = new URL(`../../public/examples/${e.file}`, import.meta.url);
      expect(existsSync(path) ? e.file : `missing: ${e.file}`).toBe(e.file);
      total += statSync(path).size;
    }
    // keep the app (and the hosted copy) small
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });
});
