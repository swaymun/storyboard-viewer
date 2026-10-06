// Every guided tour step points at a `data-tour` attribute that exists in the components (the
// e2e test `e2e/tours.spec.ts` also walks each tour in the browser).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./state.svelte', () => ({ app: {} }));
vi.mock('./player.svelte', () => ({ player: {} }));
vi.mock('./ui.svelte', () => ({ ui: {} }));

const SRC = join(import.meta.dirname, '..');
function sources(dir = SRC, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (e.name.endsWith('.svelte')) out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

describe('guided tours', async () => {
  const { TOURS } = await import('./tours');
  const text = sources().join('\n');
  const declared = new Set<string>();
  for (const m of text.matchAll(/data-tour=(?:"([^"]+)"|\{([^}]+)\})/g)) {
    if (m[1]) declared.add(m[1]);
    // data-tour={m.id} (menus) and data-tour={active ? 'shot-card' : undefined}
    for (const q of (m[2] ?? '').matchAll(/'([^']+)'/g)) declared.add(q[1]!);
  }
  for (const id of ['file-menu', 'edit-menu', 'view-menu', 'shot-menu', 'help-menu'])
    declared.add(id);

  it('has the six tours', () => {
    expect(TOURS.map((t) => t.id)).toEqual([
      'getting-started',
      'script',
      'canvas',
      'assets',
      'audio',
      'agent',
    ]);
  });

  for (const t of TOURS)
    it(`${t.title}: every step target is a data-tour hook`, () => {
      const missing = t.steps
        .filter((s) => s.target && !declared.has(s.target))
        .map((s) => s.target);
      expect(missing).toEqual([]);
      for (const s of t.steps) {
        expect(s.title.length).toBeGreaterThan(2);
        expect(s.body.length).toBeGreaterThan(20);
      }
    });
});
