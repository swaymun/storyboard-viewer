// WCAG contrast checks for every theme in src/themes.css, plus the theme registry and the
// "no hard-coded colors in components" rule.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from './theme-list';

const SRC = join(import.meta.dirname, '..');
const css = readFileSync(join(SRC, 'themes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function themeTokens(id: string): Record<string, string> {
  const re = /([^{}]+)\{([^}]*)\}/g;
  const out: Record<string, string> = {};
  for (const m of css.matchAll(re)) {
    if (!m[1]!.includes(`[data-theme='${id}']`)) continue;
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb color: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const AA = 4.5;
const PAIRS: Array<[string, string[], number]> = [
  ['--fg', ['--bg', '--surface', '--surface-2', '--surface-3', '--paper'], AA],
  ['--fg-2', ['--bg', '--surface', '--surface-2', '--paper'], AA],
  ['--fg-muted', ['--bg', '--surface', '--surface-2', '--paper'], AA],
  ['--fg-faint', ['--surface'], 2.5],
  ['--accent-text', ['--bg', '--surface', '--surface-2', '--paper'], AA],
  ['--accent-fg', ['--accent'], AA],
  ['--fg', ['--accent-soft'], AA],
  ['--danger', ['--surface', '--paper'], AA],
  ['--warn', ['--surface'], AA],
  ['--paper-fg', ['--paper'], AA],
  ['--sx-scene', ['--paper'], AA],
  ['--sx-character', ['--paper'], AA],
  ['--sx-paren', ['--paper'], AA],
  ['--sx-dialogue', ['--paper'], AA],
  ['--sx-transition', ['--paper'], AA],
  ['--sx-note', ['--paper'], AA],
  ['--sx-section', ['--paper'], AA],
  ['--sx-centered', ['--paper'], AA],
  ['--focus', ['--surface', '--paper'], 3],
];

describe('themes', () => {
  it('registry matches the stylesheet', () => {
    for (const t of THEMES) expect(Object.keys(themeTokens(t.id)).length).toBeGreaterThan(40);
  });

  for (const t of THEMES) {
    it(`${t.label}: text meets WCAG AA`, () => {
      const tk = themeTokens(t.id);
      const failures: string[] = [];
      for (const [fg, bgs, min] of PAIRS)
        for (const bg of bgs) {
          const c = contrast(tk[fg]!, tk[bg]!);
          if (c < min) failures.push(`${fg} on ${bg}: ${c.toFixed(2)} < ${min}`);
        }
      expect(failures).toEqual([]);
    });
  }

  it('platform zone tags: white label text is readable on every platform color', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!;
    const tok = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim();
    const colors = ['tiktok', 'reels', 'shorts'].map((p) => tok(`--canvas-platform-${p}`)!);
    expect(new Set(colors).size).toBe(3);
    for (const t of THEMES)
      for (const c of colors)
        expect(contrast(themeTokens(t.id)['--canvas-label-fg']!, c)).toBeGreaterThanOrEqual(AA);
  });

  it('every theme defines the same tokens', () => {
    const keys = Object.keys(themeTokens('paper')).sort();
    for (const t of THEMES) expect(Object.keys(themeTokens(t.id)).sort()).toEqual(keys);
  });

  it('components contain no hard-coded colors', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'spikes') walk(p);
        } else if (/\.(svelte|css)$/.test(e.name) && e.name !== 'themes.css') files.push(p);
      }
    };
    walk(SRC);
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (
          /#[0-9a-f]{3,8}\b(?![\w-])|\brgba?\(|\bhsla?\(/i.test(line) &&
          !/data-|href=|id=/.test(line)
        )
          bad.push(`${f.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
