// UI principles that are easy to break by accident (see CONTRIBUTING.md → UI principles).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isContextMenuKey } from './menu';

const COMPONENTS = join(import.meta.dirname, '../components');
const sources = readdirSync(COMPONENTS)
  .filter((f) => f.endsWith('.svelte'))
  .map((f) => ({ f, text: readFileSync(join(COMPONENTS, f), 'utf8') }));

describe('UI principles', () => {
  it('no dropdowns: no <select> and no <datalist> in components', () => {
    const offenders = sources
      .filter(({ text }) =>
        /<select[\s>]|<datalist[\s>]/.test(text.replace(/<!--[\s\S]*?-->/g, '')),
      )
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('context menus open from the keyboard too (Shift+F10, Menu key)', () => {
    const key = (init: KeyboardEventInit) =>
      ({ key: '', shiftKey: false, ...init }) as KeyboardEvent;
    expect(isContextMenuKey(key({ key: 'ContextMenu' }))).toBe(true);
    expect(isContextMenuKey(key({ key: 'F10', shiftKey: true }))).toBe(true);
    expect(isContextMenuKey(key({ key: 'F10' }))).toBe(false);
    // every component with a right-click menu also handles the keyboard
    const missing = sources
      .filter(({ f }) => !f.endsWith('ContextMenu.svelte'))
      .filter(({ text }) => /oncontextmenu=/.test(text) && !/isContextMenuKey|Shift-F10/.test(text))
      .map(({ f }) => f);
    expect(missing).toEqual([]);
  });
});
