/**
 * Pure geometry for the canvas editor: snapping a moving box to guide lines, aligning and
 * distributing boxes. Boxes are axis-aligned bounding boxes in canvas px (rotated layers use the
 * box around them). Kept free of Konva so it can be unit-tested.
 */
import type { SnapLine } from './safe-zones';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Snap {
  dx: number;
  dy: number;
  /** The line snapped to on each axis (null = free). */
  x: SnapLine | null;
  y: SnapLine | null;
}

function best(edges: number[], targets: readonly SnapLine[], tol: number) {
  let d = Infinity;
  let at: SnapLine | null = null;
  for (const e of edges)
    for (const t of targets) {
      const diff = t.at - e;
      if (Math.abs(diff) <= tol && Math.abs(diff) < Math.abs(d)) {
        d = diff;
        at = t;
      }
    }
  return { d: at ? d : 0, at };
}

/** Snaps a box's edges or center to the nearest target within `tol` on each axis. */
export function snapRect(
  r: Rect,
  targets: { x: readonly SnapLine[]; y: readonly SnapLine[] },
  tol: number,
): Snap {
  const sx = best([r.x, r.x + r.width / 2, r.x + r.width], targets.x, tol);
  const sy = best([r.y, r.y + r.height / 2, r.y + r.height], targets.y, tol);
  return { dx: sx.d, dy: sy.d, x: sx.at, y: sy.at };
}

/** Edges and centers of boxes as snap targets. */
export function rectTargets(rects: ReadonlyArray<{ rect: Rect; label: string }>): {
  x: SnapLine[];
  y: SnapLine[];
} {
  const x: SnapLine[] = [];
  const y: SnapLine[] = [];
  for (const { rect: o, label } of rects) {
    x.push({ at: o.x, label }, { at: o.x + o.width / 2, label }, { at: o.x + o.width, label });
    y.push({ at: o.y, label }, { at: o.y + o.height / 2, label }, { at: o.y + o.height, label });
  }
  return { x, y };
}

export function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Moves that align every box to `ref` (the selection's box or the frame). */
export function align(
  rects: ReadonlyMap<string, Rect>,
  mode: AlignMode,
  ref: Rect,
): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  for (const [id, r] of rects) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = ref.x - r.x;
    else if (mode === 'hcenter') dx = ref.x + ref.width / 2 - (r.x + r.width / 2);
    else if (mode === 'right') dx = ref.x + ref.width - (r.x + r.width);
    else if (mode === 'top') dy = ref.y - r.y;
    else if (mode === 'vcenter') dy = ref.y + ref.height / 2 - (r.y + r.height / 2);
    else dy = ref.y + ref.height - (r.y + r.height);
    out.set(id, { dx, dy });
  }
  return out;
}

/**
 * Moves that give the boxes equal gaps along an axis, keeping the first and last box (by
 * position) where they are. Needs three or more boxes; with `ref` (the frame) the outer boxes
 * move to its edges first.
 */
export function distribute(
  rects: ReadonlyMap<string, Rect>,
  axis: 'x' | 'y',
  ref?: Rect,
): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  const items = [...rects].toSorted(([, a], [, b]) => (axis === 'x' ? a.x - b.x : a.y - b.y));
  if (items.length < 2 || (items.length < 3 && !ref)) return out;
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const len = (r: Rect) => (axis === 'x' ? r.width : r.height);
  const start = ref ? pos(ref) : pos(items[0]![1]);
  const end = ref ? pos(ref) + len(ref) : pos(items.at(-1)![1]) + len(items.at(-1)![1]);
  const total = items.reduce((s, [, r]) => s + len(r), 0);
  const gap = (end - start - total) / (items.length - 1);
  let cur = start;
  for (const [id, r] of items) {
    const d = cur - pos(r);
    out.set(id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cur += len(r) + gap;
  }
  return out;
}

/**
 * Turning several layers as one: each layer's origin (its unrotated top-left, which Konva rotates
 * around) is turned by `deg` around `pivot`, and its own rotation grows by `deg`.
 */
export function rotateAbout(
  origin: { x: number; y: number },
  rotation: number,
  pivot: { x: number; y: number },
  deg: number,
): { x: number; y: number; rotation: number } {
  const a = (deg * Math.PI) / 180;
  const dx = origin.x - pivot.x;
  const dy = origin.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a),
    rotation: normalizeAngle(rotation + deg),
  };
}

/** An angle in (−180, 180]. */
export function normalizeAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d === 0 ? 0 : d; // no −0
}
