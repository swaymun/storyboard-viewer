/**
 * Print / PDF storyboard sheets. The print view is a mode of the app (`?print=1&…`): the app
 * renders sheets instead of the editor, the browser prints them (Save as PDF), and `sbd export-pdf`
 * opens the same URL in headless Chromium and calls `page.pdf()`.
 */

export type PrintLayout = 'grid' | 'rows';
export type Paper = 'letter' | 'a4';

export interface PrintOptions {
  /** `grid` = N frames per page with text below; `rows` = one row per shot, script beside it. */
  layout: PrintLayout;
  /** Shots per page for the grid layout (3, 6, 9 or 12). */
  perPage: number;
  paper: Paper;
  /** Include script lines. */
  lines: boolean;
  /** Include shot fields (camera, movement, …). */
  fields: boolean;
  /** Include the notes field. */
  notes: boolean;
  /** Title page with project details. */
  titlePage: boolean;
}

export const DEFAULT_PRINT: PrintOptions = {
  layout: 'grid',
  perPage: 6,
  paper: 'letter',
  lines: true,
  fields: true,
  notes: true,
  titlePage: true,
};

export const PER_PAGE = [3, 6, 9, 12] as const;

/** Reads print options from the URL (`?print=1&layout=rows&per=6&paper=a4&lines=0…`). */
export function readPrintParams(search: string): PrintOptions | null {
  const q = new URLSearchParams(search);
  if (!q.has('print')) return null;
  const bool = (k: string, d: boolean) => (q.has(k) ? q.get(k) !== '0' : d);
  const per = Number(q.get('per'));
  return {
    layout: q.get('layout') === 'rows' ? 'rows' : 'grid',
    perPage: (PER_PAGE as readonly number[]).includes(per) ? per : DEFAULT_PRINT.perPage,
    paper: q.get('paper') === 'a4' ? 'a4' : 'letter',
    lines: bool('lines', true),
    fields: bool('fields', true),
    notes: bool('notes', true),
    titlePage: bool('title', true),
  };
}

export function printParams(o: PrintOptions): URLSearchParams {
  const q = new URLSearchParams({ print: '1', layout: o.layout, paper: o.paper });
  if (o.layout === 'grid') q.set('per', String(o.perPage));
  if (!o.lines) q.set('lines', '0');
  if (!o.fields) q.set('fields', '0');
  if (!o.notes) q.set('notes', '0');
  if (!o.titlePage) q.set('title', '0');
  return q;
}

/** Grid columns × rows for N shots per page, given the frame aspect (width / height). */
export function gridShape(perPage: number, aspect: number): { cols: number; rows: number } {
  const vertical = aspect < 1;
  switch (perPage) {
    case 3:
      return { cols: 3, rows: 1 };
    case 9:
      return { cols: 3, rows: 3 };
    case 12:
      return vertical ? { cols: 6, rows: 2 } : { cols: 4, rows: 3 };
    default:
      return vertical ? { cols: 6, rows: 1 } : { cols: 3, rows: 2 };
  }
}

/** Orientation of the paper: grids are landscape, rows portrait. */
export function pageOrientation(o: PrintOptions): 'landscape' | 'portrait' {
  return o.layout === 'grid' ? 'landscape' : 'portrait';
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Footer text in @page margin boxes (they cannot read custom properties reliably). */
export const PRINT_FOOTER = '#777777';
