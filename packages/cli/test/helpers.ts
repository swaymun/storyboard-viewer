import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG = fileURLToPath(new URL('../', import.meta.url));
export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const EXAMPLE = join(ROOT, 'examples/minimal.sbd');

/** Copies the example into a temp dir; returns the copy and a cleanup function. */
export function exampleCopy(name = 'story.sbd'): {
  dir: string;
  work: string;
  cleanup: () => void;
} {
  const work = mkdtempSync(join(tmpdir(), 'sbd-'));
  const dir = join(work, name);
  cpSync(EXAMPLE, dir, { recursive: true });
  return { dir, work, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

// oxlint-disable-next-line typescript/no-explicit-any
export async function getJson(url: string): Promise<any> {
  return (await fetch(url)).json();
}
