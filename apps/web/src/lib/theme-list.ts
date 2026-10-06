/**
 * Themes in src/themes.css. Token blocks use `[data-theme=…]` selectors, so any element can preview
 * a theme (the picker's swatches set `data-theme` on a small sample).
 */
export interface ThemeDef {
  id: string;
  label: string;
  kind: 'light' | 'dark';
  credit?: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: 'paper', label: 'Paper', kind: 'light' },
  { id: 'darkroom', label: 'Darkroom', kind: 'dark' },
  { id: 'neutral', label: 'Neutral Pro', kind: 'dark' },
  {
    id: 'neutral-light',
    label: 'Neutral Pro Light',
    kind: 'light',
  },
  {
    id: 'maomao-dark',
    label: 'Maomao Dark',
    kind: 'dark',
    credit: 'Apothecary Diary',
  },
  {
    id: 'maomao-light',
    label: 'Maomao Light',
    kind: 'light',
    credit: 'Apothecary Diary',
  },
  {
    id: 'jinshi-dark',
    label: 'Jinshi Dark',
    kind: 'dark',
    credit: 'Apothecary Diary',
  },
  {
    id: 'jinshi-light',
    label: 'Jinshi Light',
    kind: 'light',
    credit: 'Apothecary Diary',
  },
];

export const DEFAULT_LIGHT = 'paper';
export const DEFAULT_DARK = 'darkroom';
/** localStorage keys (also read by the pre-paint script in index.html). */
export const THEME_KEY = 'sbd:theme';
export const THEME_PAIR_KEY = 'sbd:theme-pair';
