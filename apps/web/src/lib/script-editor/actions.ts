/**
 * Shot actions of the script editor, as pure functions over the project (format ops underneath).
 */
import {
  addShot,
  comparePoints,
  pointAt,
  scriptDocument,
  setShotLines,
  setShotSpan,
  shotBounds,
  textLookup,
  type SbdProject,
  type ScriptPoint,
  type SpanPoint,
} from '@storyboard-viewer/format';

const ordinals = (p: SbdProject) => new Map(p.ids.lines.map((l) => [l.id, l.ordinal]));

/**
 * Shot-order index for a new shot that starts at `point` in the script: right after the last
 * shot that starts before it (lineless shots right after that one stay before the new one).
 */
export function indexForPoint(
  p: SbdProject,
  point: ScriptPoint,
  exclude: Set<string> = new Set(),
): number {
  const ord = ordinals(p);
  const textOf = textLookup(p.ids.lines);
  let index = 0;
  p.ids.shots.forEach((s, i) => {
    const lines = s.lines.filter((l) => !exclude.has(l));
    if (!lines.length) return;
    const b = shotBounds({ ...s, lines }, (id) => ord.get(id), textOf);
    if (b && comparePoints(b.start, point) < 0) index = i + 1;
  });
  // keep lineless shots that directly follow that shot before the new one
  while (index < p.ids.shots.length && index > 0 && !p.ids.shots[index]!.lines.length) index++;
  return index;
}

/** Shot-order index for a new shot whose script position is line `ordinal`. */
export function indexForOrdinal(
  p: SbdProject,
  ordinal: number,
  exclude: Set<string> = new Set(),
): number {
  return indexForPoint(p, { ordinal, offset: 0 }, exclude);
}

/** "Make shot": a new shot covering these lines (taken out of other shots), placed in order. */
export function makeShot(
  p: SbdProject,
  lineIds: readonly string[],
): { project: SbdProject; id: string } {
  if (!lineIds.length) throw new Error('Select one or more script lines first');
  const ord = ordinals(p);
  const first = Math.min(...lineIds.map((l) => ord.get(l) ?? Infinity));
  const index = indexForOrdinal(p, first, new Set(lineIds));
  return addShot(p, { lines: [...lineIds], index });
}

/**
 * The script text between two document positions as span points (outside script lines, e.g. on a
 * blank line or a character cue, they snap to the nearest line). Null when nothing is in between.
 */
export function spanFromRange(
  p: SbdProject,
  from: number,
  to: number,
): { start: SpanPoint; end: SpanPoint } | null {
  const doc = scriptDocument(p);
  if (!doc) return null;
  const a = pointAt(doc, from, 'start');
  const z = pointAt(doc, to, 'end');
  if (!a || !z || comparePoints(a, z) >= 0) return null;
  const byOrd = p.ids.lines.toSorted((x, y) => x.ordinal - y.ordinal);
  const s = byOrd[a.ordinal];
  const e = byOrd[z.ordinal];
  if (!s || !e) return null;
  return { start: { line: s.id, offset: a.offset }, end: { line: e.id, offset: z.offset } };
}

/**
 * "Make shot" from a selection: a new shot on exactly that text (part of a line, several lines),
 * taken out of other shots and placed in script order. One action, no form.
 */
export function makeShotFromSpan(
  p: SbdProject,
  start: SpanPoint,
  end: SpanPoint,
): { project: SbdProject; id: string } {
  const ord = ordinals(p);
  const point = { ordinal: ord.get(start.line) ?? 0, offset: start.offset };
  const index = indexForPoint(p, point);
  const r = addShot(p, { index });
  return { project: setShotSpan(r.project, r.id, start, end), id: r.id };
}

/** "Extend shot to selection": the shot covers its own text and the selection (and between). */
export function extendShotTo(
  p: SbdProject,
  shotId: string,
  start: SpanPoint,
  end: SpanPoint,
): SbdProject {
  const ref = p.ids.shots.find((s) => s.id === shotId);
  if (!ref) return p;
  const ord = ordinals(p);
  const textOf = textLookup(p.ids.lines);
  const b = shotBounds(ref, (id) => ord.get(id), textOf);
  const sel = {
    start: { ordinal: ord.get(start.line)!, offset: start.offset },
    end: { ordinal: ord.get(end.line)!, offset: end.offset },
  };
  const s = b && comparePoints(b.start, sel.start) < 0 ? b.start : sel.start;
  const e = b && comparePoints(b.end, sel.end) > 0 ? b.end : sel.end;
  const byOrd = p.ids.lines.toSorted((x, y) => x.ordinal - y.ordinal);
  return setShotSpan(
    p,
    shotId,
    { line: byOrd[s.ordinal]!.id, offset: s.offset },
    { line: byOrd[e.ordinal]!.id, offset: e.offset },
  );
}

/** A shot without script lines, placed after the shot at/before `ordinal` (null = at the start). */
export function addLinelessShot(
  p: SbdProject,
  ordinal: number | null,
): { project: SbdProject; id: string } {
  if (ordinal === null) return addShot(p, { index: 0 });
  // after the shot that contains the line at `ordinal`, or after the last one before it
  return addShot(p, { index: indexForOrdinal(p, ordinal + 1) });
}

/**
 * Moves a shot's first (`start`) or last (`end`) line by `delta` lines in script order: growing
 * takes the neighbouring line (from another shot if needed), shrinking leaves it unassigned. A
 * shot keeps at least one line.
 */
export function adjustBoundary(
  p: SbdProject,
  shotId: string,
  edge: 'start' | 'end',
  delta: number,
): SbdProject {
  const ref = p.ids.shots.find((s) => s.id === shotId);
  if (!ref?.lines.length) return p;
  const ord = ordinals(p);
  const byOrd = p.ids.lines.toSorted((a, b) => a.ordinal - b.ordinal).map((l) => l.id);
  const own = ref.lines.toSorted((a, b) => ord.get(a)! - ord.get(b)!);
  let lo = ord.get(own[0]!)!;
  let hi = ord.get(own.at(-1)!)!;
  if (edge === 'start') lo = Math.max(0, Math.min(hi, lo + delta));
  else hi = Math.min(byOrd.length - 1, Math.max(lo, hi + delta));
  const keep = own.filter((l) => ord.get(l)! >= lo && ord.get(l)! <= hi);
  const extra = byOrd.slice(lo, hi + 1).filter((l) => !keep.includes(l));
  // growing adds the new lines; lines of the shot inside the range stay
  const lines = [
    ...keep,
    ...extra.filter((l) => ord.get(l)! < ord.get(own[0]!)! || ord.get(l)! > ord.get(own.at(-1)!)!),
  ];
  if (!lines.length) return p;
  return setShotLines(p, shotId, lines);
}
