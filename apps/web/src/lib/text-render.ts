/**
 * Text layers (format 0.3) drawn with the 2D canvas API. One drawing routine serves every
 * renderer — the Konva editor (a custom Shape), the DOM cards / print view (a <canvas> per text
 * layer) and the animatic video export — so captions wrap and look the same everywhere.
 *
 * Geometry: the layer's `x/y` is the top-left of the text box, `width` its width (lines wrap
 * inside it, minus the box padding); the height follows from the lines. Rotation and scale are
 * applied by the caller around the origin, like image layers.
 */
import { TEXT_DEFAULTS, type Asset, type Layer } from '@storyboard-viewer/format';
import { ensureFont, fontFamily } from './fonts';

/** Fallback stacks for the bundled families (the app ships these fonts). */
const STACKS: Record<string, string> = {
  'IBM Plex Sans': "'IBM Plex Sans', system-ui, sans-serif",
  Montserrat: "Montserrat, 'IBM Plex Sans', system-ui, sans-serif",
  'Courier Prime': "'Courier Prime', 'Courier New', monospace",
  'IBM Plex Mono': "'IBM Plex Mono', ui-monospace, monospace",
};

/** Fonts the text controls offer (bundled with the app, so every renderer has them). */
export const TEXT_FONTS: ReadonlyArray<{ family: string; label: string }> = [
  { family: 'IBM Plex Sans', label: 'Sans' },
  { family: 'Montserrat', label: 'Display' },
  { family: 'Courier Prime', label: 'Typewriter' },
  { family: 'IBM Plex Mono', label: 'Mono' },
];

/** Swatches for text and box colors (content colors, not theme colors). */
export const TEXT_COLORS: readonly string[] = [
  '#ffffff',
  '#111111',
  '#ffe14d',
  '#ff4d6d',
  '#3ddc97',
  '#4da3ff',
];

export const BOX_COLORS: readonly string[] = [
  '#ffffff',
  '#111111',
  'rgba(12,14,18,0.72)',
  '#ffe14d',
  '#ff4d6d',
];

export interface TextMetrics {
  lines: string[];
  /** Box size in canvas px (unscaled). */
  width: number;
  height: number;
  lineHeight: number;
  padding: number;
}

/** CSS font-family of a text layer (a font asset when set, else a bundled family). */
export function textFamily(l: Layer): string {
  if (l.font_asset) return `${fontFamily(l.font_asset)}, ${STACKS['IBM Plex Sans']}`;
  const f = l.font ?? TEXT_DEFAULTS.font;
  return STACKS[f] ?? `'${f.replace(/'/g, '')}', ${STACKS['IBM Plex Sans']}`;
}

export const fontSize = (l: Layer) => l.font_size ?? TEXT_DEFAULTS.font_size;

/** CSS `font` shorthand for a text layer. */
export function textFont(l: Layer): string {
  const weight = l.font_weight ?? TEXT_DEFAULTS.font_weight;
  return `${l.italic ? 'italic ' : ''}${weight} ${fontSize(l)}px ${textFamily(l)}`;
}

/** Default wrap width when a text layer has none: most of a 1920 px frame. */
const DEFAULT_WIDTH = 800;

function wrapLines(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  max: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line && ctx.measureText(next.trimEnd()).width > max && !/^\s+$/.test(w)) {
        out.push(line.trimEnd());
        line = w.trimStart();
        // a single word wider than the box is broken by characters
        while (ctx.measureText(line).width > max && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > max) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

let scratch: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!scratch) {
    scratch =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(4, 4).getContext('2d')
        : document.createElement('canvas').getContext('2d');
  }
  return scratch!;
}

/** How far outline and shadow reach outside the text box (canvas px). */
export function textBleed(l: Layer): number {
  const stroke = l.stroke?.width ?? 0;
  const sh = l.shadow
    ? (l.shadow.blur ?? 0) +
      Math.max(Math.abs(l.shadow.offset_x ?? 0), Math.abs(l.shadow.offset_y ?? 0))
    : 0;
  return Math.ceil(stroke * 2 + sh + fontSize(l) * 0.15);
}

/** Wraps the text and measures the box. */
export function measureText(l: Layer): TextMetrics {
  const ctx = measureCtx();
  ctx.font = textFont(l);
  const size = fontSize(l);
  const padding = l.box ? (l.box.padding ?? Math.round(size * 0.3)) : 0;
  const width = l.width ?? DEFAULT_WIDTH;
  const raw = l.uppercase ? (l.text ?? '').toUpperCase() : (l.text ?? '');
  const lines = wrapLines(ctx, raw, Math.max(1, width - padding * 2));
  const lineHeight = size * (l.line_height ?? TEXT_DEFAULTS.line_height);
  return { lines, width, height: lines.length * lineHeight + padding * 2, lineHeight, padding };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draws a text layer at the current origin (the top-left of its box). */
export function drawText(ctx: Ctx, l: Layer, m: TextMetrics = measureText(l)): void {
  const size = fontSize(l);
  const align = l.align ?? TEXT_DEFAULTS.align;
  ctx.save();
  ctx.font = textFont(l);
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const inner = m.width - m.padding * 2;
  const ax = align === 'left' ? m.padding : align === 'right' ? m.width - m.padding : m.width / 2;
  const lineY = (i: number) => m.padding + m.lineHeight * (i + 0.5);
  if (l.box) {
    const pad = m.padding;
    const r = l.box.radius ?? Math.round(size * 0.2);
    ctx.fillStyle = l.box.color;
    m.lines.forEach((line, i) => {
      if (!line) return;
      const w = Math.min(inner, ctx.measureText(line).width);
      const left = align === 'left' ? ax : align === 'right' ? ax - w : ax - w / 2;
      const top = lineY(i) - m.lineHeight / 2;
      ctx.beginPath();
      ctx.roundRect(
        left - pad,
        top - (i === 0 ? pad : 0),
        w + pad * 2,
        m.lineHeight + (i === 0 ? pad : 0) + (i === m.lines.length - 1 ? pad : 0),
        r,
      );
      ctx.fill();
    });
  }
  const color = l.color ?? TEXT_DEFAULTS.color;
  const stroke = l.stroke && l.stroke.width > 0 ? l.stroke : null;
  const paint = (withShadow: boolean) => {
    if (withShadow && l.shadow) {
      ctx.shadowColor = l.shadow.color;
      ctx.shadowBlur = l.shadow.blur ?? 0;
      ctx.shadowOffsetX = l.shadow.offset_x ?? 0;
      ctx.shadowOffsetY = l.shadow.offset_y ?? 0;
    }
    m.lines.forEach((line, i) => {
      if (stroke) {
        ctx.strokeStyle = stroke.color;
        // the outline is centered on the glyph edge: double it so `width` shows outside
        ctx.lineWidth = stroke.width * 2;
        ctx.strokeText(line, ax, lineY(i));
      }
      if (!withShadow || !stroke) {
        ctx.fillStyle = color;
        ctx.fillText(line, ax, lineY(i));
      }
    });
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };
  // shadow under the outline, then the fill on top without a second shadow
  paint(true);
  if (stroke) paint(false);
  ctx.restore();
}

/**
 * Loads the fonts of these text layers (bundled families through `document.fonts`, font assets
 * through `FontFace`). Resolves when they can be drawn; never rejects.
 */
export async function loadTextFonts(
  layers: readonly Layer[],
  assets: Map<string, Asset>,
  url: (src: string) => string | null,
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const jobs: Promise<unknown>[] = [];
  for (const l of layers) {
    if (l.kind !== 'text') continue;
    if (l.font_asset) {
      const a = assets.get(l.font_asset);
      if (a) jobs.push(ensureFont(a.id, url(a.src)));
    }
    jobs.push(document.fonts.load(textFont(l), l.text || 'A').catch(() => []));
  }
  await Promise.all(jobs);
}

/** Content colors for the text controls (not theme colors: they are part of the picture). */
export const TEXT_DEFAULT_COLOR = TEXT_DEFAULTS.color;
export const defaultStroke = (size: number) => ({
  color: '#000000',
  width: Math.max(2, Math.round(size * 0.09)),
});
export const defaultShadow = (size: number) => ({
  color: 'rgba(0,0,0,0.6)',
  blur: Math.round(size * 0.2),
  offset_y: Math.round(size * 0.05),
});
export const defaultBox = () => ({ color: '#111111' });
/** A #rrggbb value for a color input (the text color when it is one, else white). */
export const hexColor = (c: string | undefined) =>
  c && /^#[0-9a-f]{6}$/i.test(c) ? c : TEXT_DEFAULTS.color;
