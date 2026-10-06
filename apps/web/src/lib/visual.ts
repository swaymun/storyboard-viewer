import {
  KNOWN_FILTERS,
  aspectValue,
  type CanvasVariant,
  type LayerFilter,
  type Manifest,
} from '@storyboard-viewer/format';

/**
 * CSS `filter` string for layer filters (SBD filters use CSS filter semantics). Blur is in canvas
 * pixels; `length` converts it when the composition is drawn at another size (DOM previews).
 */
export function cssFilter(
  filters: readonly LayerFilter[] | undefined,
  length: (px: number) => string = (px) => `${px}px`,
): string {
  if (!filters?.length) return 'none';
  const parts: string[] = [];
  for (const f of filters) {
    if (!(KNOWN_FILTERS as readonly string[]).includes(f.type)) continue;
    const v = f.value;
    switch (f.type) {
      case 'blur':
        parts.push(`blur(${length(v ?? 4)})`);
        break;
      case 'hue_rotate':
        parts.push(`hue-rotate(${v ?? 0}deg)`);
        break;
      default:
        parts.push(`${f.type}(${v ?? 1})`);
    }
  }
  return parts.join(' ') || 'none';
}

/** Canvas size of a composition (variant size, else manifest canvas, else from aspect ratio). */
export function canvasSize(
  v: CanvasVariant,
  m: Manifest | undefined,
): { width: number; height: number } {
  if (v.width && v.height) return { width: v.width, height: v.height };
  if (m?.canvas) return m.canvas;
  const a = aspectValue(m?.aspect_ratio);
  return a >= 1
    ? { width: 1920, height: Math.round(1920 / a) }
    : { width: Math.round(1920 * a), height: 1920 };
}

export function frameAspect(m: Manifest | undefined): string {
  const [w, h] = (m?.aspect_ratio ?? '16:9').split(':');
  return `${w} / ${h}`;
}
