/**
 * Sub-line shot spans (format 0.2): a shot covers its `lines`, and optionally starts at character
 * `start.offset` of its first line and ends at character `end.offset` (exclusive) of its last line.
 * Offsets count UTF-16 code units of the line's `text` (as in ids.json: markers and inline notes
 * removed). Omitted `start` / `end` = the whole first / last line, so 0.1 files (whole lines only)
 * stay valid as they are.
 *
 * Everything here is pure and works on line texts (`ids.json` entries), so it runs in the app, the
 * CLI and the MCP server alike. Edits keep spans attached to their text:
 * - tool / editor edits map span positions through the exact text changes (`mapSpanPos`),
 * - hand edits, `set_script` and merges map them through a per-line text diff (`mapTextOffset`),
 * - `normalizeShotRef` clamps what is left and drops redundant offsets.
 *
 * Shots never overlap: making a shot from a span takes that text out of other shots
 * (`carveShots`). Two shots may share a line when their spans do not overlap.
 */
import { textOffsetToSource, sourceToTextOffset, type FountainDocument } from './fountain.js';
import { diffLines, type LineIdEntry } from './reanchor.js';
import type { ShotRef, SpanPoint } from './types.js';

export type TextOf = (lineId: string) => string | undefined;

/** Line ID → text, from ids.json entries. */
export function textLookup(entries: readonly LineIdEntry[]): TextOf {
  const m = new Map(entries.map((e) => [e.id, e.text]));
  return (id) => m.get(id);
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.round(n) : lo));

/** True when the shot uses character offsets on its first or last line. */
export function hasSpan(ref: Pick<ShotRef, 'start' | 'end'>): boolean {
  return !!(ref.start || ref.end);
}

/** The part of one line that a shot covers: `[from, to)` in the line's text. */
export interface ShotSegment {
  line: string;
  from: number;
  to: number;
  /** The whole line. */
  whole: boolean;
}

/** Per line, the characters a shot covers (whole lines in the middle; first/last may be partial). */
export function shotSegments(ref: ShotRef, textOf: TextOf): ShotSegment[] {
  const n = ref.lines.length;
  return ref.lines.map((line, i) => {
    const len = textOf(line)?.length ?? 0;
    let from = 0;
    let to = len;
    if (i === 0 && ref.start?.line === line) from = clamp(ref.start.offset, 0, len);
    if (i === n - 1 && ref.end?.line === line) to = clamp(ref.end.offset, 0, len);
    if (to < from) to = from;
    return { line, from, to, whole: from === 0 && to === len };
  });
}

export interface LineSegment {
  shot: string;
  from: number;
  to: number;
  whole: boolean;
}

/** Line ID → the shots covering (part of) it, sorted by position in the line. */
export function lineSegments(refs: readonly ShotRef[], textOf: TextOf): Map<string, LineSegment[]> {
  const out = new Map<string, LineSegment[]>();
  for (const ref of refs)
    for (const s of shotSegments(ref, textOf)) {
      let list = out.get(s.line);
      if (!list) out.set(s.line, (list = []));
      list.push({ shot: ref.id, from: s.from, to: s.to, whole: s.whole });
    }
  for (const list of out.values()) list.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

/**
 * Cleans a shot's span: drops `start` / `end` that do not sit on the first / last line, clamps
 * offsets, removes offsets that mean "whole line" (0 and the line length), drops a first line the
 * span starts at the very end of (and a last line it ends at the very start of), and turns an empty
 * span into a shot without lines. Returns `ref` itself when nothing changed.
 */
export function normalizeShotRef(ref: ShotRef, textOf: TextOf): ShotRef {
  if (!ref.start && !ref.end) return ref;
  let lines = [...ref.lines];
  const len = (id: string | undefined) => (id === undefined ? 0 : (textOf(id)?.length ?? 0));
  let start: SpanPoint | undefined =
    ref.start && ref.start.line === lines[0]
      ? { line: ref.start.line, offset: clamp(ref.start.offset, 0, len(lines[0])) }
      : undefined;
  let end: SpanPoint | undefined =
    ref.end && ref.end.line === lines.at(-1)
      ? { line: ref.end.line, offset: clamp(ref.end.offset, 0, len(lines.at(-1))) }
      : undefined;
  if (start && lines.length > 1 && start.offset >= len(lines[0])) {
    lines = lines.slice(1);
    start = undefined;
  }
  if (end && lines.length > 1 && end.offset <= 0) {
    lines = lines.slice(0, -1);
    end = undefined;
  }
  if (lines.length === 1) {
    const a = start?.offset ?? 0;
    const z = end?.offset ?? len(lines[0]);
    if (z <= a && len(lines[0]) > 0) {
      lines = [];
      start = end = undefined;
    }
  }
  if (start && start.offset === 0) start = undefined;
  if (end && end.offset >= len(lines.at(-1))) end = undefined;
  if (!lines.length) start = end = undefined;
  const same =
    lines.length === ref.lines.length &&
    lines.every((l, i) => l === ref.lines[i]) &&
    start?.line === ref.start?.line &&
    start?.offset === ref.start?.offset &&
    end?.line === ref.end?.line &&
    end?.offset === ref.end?.offset;
  if (same) return ref;
  const { start: _s, end: _e, ...rest } = ref;
  const out: ShotRef = { ...rest, lines };
  if (start) out.start = start;
  if (end) out.end = end;
  return out;
}

/** `normalizeShotRef` for a list; returns the same array when nothing changed. */
export function normalizeShotRefs(refs: readonly ShotRef[], textOf: TextOf): ShotRef[] {
  let changed = false;
  const out = refs.map((r) => {
    const n = normalizeShotRef(r, textOf);
    if (n !== r) changed = true;
    return n;
  });
  return changed ? out : (refs as ShotRef[]);
}

// ---------------------------------------------------------------------------
// Mapping through edits

/** One text change: old `[from, to)` replaced by `length` new characters (old coordinates). */
export interface PosChange {
  from: number;
  to: number;
  length: number;
  /** The inserted text, when known (needed for `lineStart` / `lineEnd` boundaries). */
  text?: string;
}

/**
 * Which boundary a position is:
 * - `start` / `end`: a span boundary at a character offset. Text **inserted exactly at** it stays
 *   outside the span (typing right after a shot's end, or right before its start, does not grow
 *   the shot). Text typed **inside** a span grows it; text that **replaces** part of a span (a
 *   selection reaching into it) belongs to the span.
 * - `lineStart` / `lineEnd`: the edge of a whole first / last line. Text typed at the edge joins
 *   the line (and so the shot) up to a line break: Enter starts a line outside it.
 */
export type SpanSide = 'start' | 'end' | 'lineStart' | 'lineEnd';

/** Maps a span boundary through changes (sorted, non-overlapping, old coordinates). */
export function mapSpanPos(pos: number, changes: readonly PosChange[], side: SpanSide): number {
  let delta = 0;
  for (const c of changes) {
    if (pos < c.from) break;
    if (c.from === c.to) {
      if (pos === c.from) {
        const t = c.text;
        switch (side) {
          case 'start':
            return pos + delta + c.length;
          case 'end':
            return pos + delta;
          case 'lineStart':
            return pos + delta + (t ? t.lastIndexOf('\n') + 1 : 0);
          case 'lineEnd': {
            const nl = t ? t.indexOf('\n') : -1;
            return pos + delta + (nl < 0 ? c.length : nl);
          }
        }
      }
      delta += c.length;
      continue;
    }
    const startLike = side === 'start' || side === 'lineStart';
    if (pos === c.from) return c.from + delta;
    if (pos < c.to) return startLike ? c.from + delta : c.from + delta + c.length;
    if (pos === c.to) return c.from + delta + c.length;
    delta += c.length - (c.to - c.from);
  }
  return pos + delta;
}

/** The single change that turns `a` into `b` (common prefix and suffix). */
export function textChange(a: string, b: string): PosChange | null {
  if (a === b) return null;
  const max = Math.min(a.length, b.length);
  let pre = 0;
  while (pre < max && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  let suf = 0;
  while (suf < max - pre && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf))
    suf++;
  return {
    from: pre,
    to: a.length - suf,
    length: b.length - suf - pre,
    text: b.slice(pre, b.length - suf),
  };
}

const TOKEN = /\s+|[\p{L}\p{N}_'’-]+|./gu;

/**
 * The changes that turn `a` into `b` (old coordinates, sorted), from a diff over words, spaces and
 * punctuation: "Honestly, I was … the cars" → "… the trucks" gives two changes, so a span on
 * "the cops" in between does not move.
 */
export function textChanges(a: string, b: string): PosChange[] {
  if (a === b) return [];
  const one = textChange(a, b)!;
  // the common prefix/suffix first; diff only the middle
  const midA = a.slice(one.from, one.to);
  const midB = b.slice(one.from, one.from + one.length);
  const ta = midA.match(TOKEN) ?? [];
  const tb = midB.match(TOKEN) ?? [];
  if (ta.length * tb.length > 250_000 || !ta.length || !tb.length) return [one];
  const offA = [0];
  for (const t of ta) offA.push(offA.at(-1)! + t.length);
  const offB = [0];
  for (const t of tb) offB.push(offB.at(-1)! + t.length);
  const pairs = [...diffLines(ta, tb), [ta.length, tb.length] as [number, number]];
  const out: PosChange[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    if (pi > i || pj > j) {
      const text = midB.slice(offB[j]!, offB[pj]!);
      out.push({
        from: one.from + offA[i]!,
        to: one.from + offA[pi]!,
        length: text.length,
        text,
      });
    }
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

/** Maps a character offset of `oldText` to `newText` (a span boundary, see `mapSpanPos`). */
export function mapTextOffset(
  oldText: string,
  newText: string,
  offset: number,
  side: SpanSide,
): number {
  const cs = textChanges(oldText, newText);
  if (!cs.length) return offset;
  return clamp(mapSpanPos(offset, cs, side), 0, newText.length);
}

/**
 * Hand edits, `set_script`, merges: line texts changed (IDs kept), so move offsets with each
 * line's own text diff. `oldText` / `newText` give the text a point was written against and the
 * current text of that line.
 */
export function remapSpansByText(
  refs: readonly ShotRef[],
  oldText: TextOf,
  newText: TextOf,
  /** Per shot and boundary: which texts the point refers to (defaults to oldText). */
  sourceOf?: (ref: ShotRef, which: 'start' | 'end') => TextOf,
): ShotRef[] {
  let changed = false;
  const out = refs.map((r) => {
    if (!hasSpan(r)) return r;
    const next: ShotRef = { ...r };
    let touched = false;
    for (const which of ['start', 'end'] as const) {
      const pt = r[which];
      if (!pt) continue;
      const before = (sourceOf?.(r, which) ?? oldText)(pt.line);
      const after = newText(pt.line);
      if (before === undefined || after === undefined || before === after) continue;
      next[which] = { ...pt, offset: mapTextOffset(before, after, pt.offset, which) };
      touched = true;
    }
    if (!touched) return r;
    changed = true;
    return next;
  });
  return changed ? out : (refs as ShotRef[]);
}

/** A position in the script: line ordinal + character offset in that line's text. */
export interface ScriptPoint {
  ordinal: number;
  offset: number;
}

/**
 * The line and character at source position `pos`. Positions outside any script line (blank
 * lines, character cues, notes) snap to the next line's start (`start`) or the previous line's
 * end (`end`).
 */
export function pointAt(
  doc: FountainDocument,
  pos: number,
  side: 'start' | 'end',
): ScriptPoint | null {
  const lines = doc.lines;
  // last line starting at or before pos
  let lo = 0;
  let hi = lines.length - 1;
  let k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.start <= pos) {
      k = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const el = k >= 0 ? lines[k] : undefined;
  if (el && pos <= el.end && el.startLine === el.endLine)
    return { ordinal: k, offset: sourceToTextOffset(el, pos) };
  if (side === 'start') {
    const next = lines[k + 1];
    return next ? { ordinal: k + 1, offset: 0 } : null;
  }
  return el ? { ordinal: k, offset: el.text.length } : null;
}

/** Source position of a span boundary. */
export function sourceOfPoint(doc: FountainDocument, p: ScriptPoint): number | null {
  const el = doc.lines[p.ordinal];
  return el ? textOffsetToSource(el, p.offset) : null;
}

/** Compares two script points. */
export const comparePoints = (a: ScriptPoint, b: ScriptPoint) =>
  a.ordinal - b.ordinal || a.offset - b.offset;

/**
 * Start and end of a shot as script points (`end` exclusive), or null for shots without lines.
 * Uses the first and last line in script order.
 */
export function shotBounds(
  ref: ShotRef,
  ordinal: (id: string) => number | undefined,
  textOf: TextOf,
): { start: ScriptPoint; end: ScriptPoint } | null {
  const segs = shotSegments(ref, textOf).filter((s) => ordinal(s.line) !== undefined);
  if (!segs.length) return null;
  segs.sort((a, b) => ordinal(a.line)! - ordinal(b.line)!);
  const first = segs[0]!;
  const last = segs.at(-1)!;
  return {
    start: { ordinal: ordinal(first.line)!, offset: first.from },
    end: { ordinal: ordinal(last.line)!, offset: last.to },
  };
}

/**
 * Takes the text `[start, end)` out of other shots so a shot can own it. A shot that loses text in
 * the middle keeps the part before the span (the part after becomes unassigned: shots are
 * contiguous); a shot entirely inside the span loses all its lines.
 */
export function carveShots(
  refs: readonly ShotRef[],
  keep: string,
  start: ScriptPoint,
  end: ScriptPoint,
  entries: readonly LineIdEntry[],
): ShotRef[] {
  const ord = new Map(entries.map((e) => [e.id, e.ordinal]));
  const textOf = textLookup(entries);
  return refs.map((r) => {
    if (r.id === keep || !r.lines.length) return r;
    const segs = shotSegments(r, textOf).filter((s) => ord.has(s.line));
    const overlaps = segs.some((s) => {
      const o = ord.get(s.line)!;
      const a = { ordinal: o, offset: s.from };
      const z = { ordinal: o, offset: s.to };
      if (s.to === s.from) return comparePoints(a, start) >= 0 && comparePoints(a, end) < 0;
      return comparePoints(a, end) < 0 && comparePoints(z, start) > 0;
    });
    if (!overlaps) return r;
    type Piece = { line: string; from: number; to: number };
    const before: Piece[] = [];
    const after: Piece[] = [];
    for (const s of segs) {
      const o = ord.get(s.line)!;
      if (o < start.ordinal) before.push(s);
      else if (o === start.ordinal && s.from < start.offset)
        before.push({ ...s, to: Math.min(s.to, start.offset) });
      if (o > end.ordinal) after.push(s);
      else if (o === end.ordinal && s.to > end.offset)
        after.push({ ...s, from: Math.max(s.from, end.offset) });
    }
    const pieces = before.length ? before : after;
    if (!pieces.length) {
      const { start: _s, end: _e, ...rest } = r;
      return { ...rest, lines: [] };
    }
    const first = pieces[0]!;
    const last = pieces.at(-1)!;
    const { start: _s, end: _e, ...rest } = r;
    const out: ShotRef = { ...rest, lines: pieces.map((p) => p.line) };
    if (first.from > 0) out.start = { line: first.line, offset: first.from };
    if (last.to < (textOf(last.line)?.length ?? 0)) out.end = { line: last.line, offset: last.to };
    return normalizeShotRef(out, textOf);
  });
}

/**
 * Finds `text` in the given lines (their texts joined with "\n", so a span may cross lines) and
 * returns it as start / end points. `occurrence` picks the n-th match (1-based).
 */
export function locateSpan(
  lineIds: readonly string[],
  textOf: TextOf,
  text: string,
  occurrence = 1,
): { start: SpanPoint; end: SpanPoint } | null {
  if (!text) return null;
  const parts = lineIds.map((id) => textOf(id) ?? '');
  const joined = parts.join('\n');
  let at = -1;
  for (let n = 0; n < Math.max(1, occurrence); n++) {
    at = joined.indexOf(text, at + 1);
    if (at < 0) return null;
  }
  const point = (abs: number, side: 'start' | 'end'): SpanPoint => {
    let base = 0;
    for (let i = 0; i < parts.length; i++) {
      const len = parts[i]!.length;
      if (abs <= base + len && (side === 'end' || abs < base + len || i === parts.length - 1))
        return { line: lineIds[i]!, offset: abs - base };
      base += len + 1;
    }
    return { line: lineIds.at(-1)!, offset: parts.at(-1)!.length };
  };
  return { start: point(at, 'start'), end: point(at + text.length, 'end') };
}

/** The text a shot covers, line by line (partial first/last lines cut to the span). */
export function shotTexts(
  ref: ShotRef,
  textOf: TextOf,
): Array<{ line: string; text: string; from: number; to: number; whole: boolean }> {
  return shotSegments(ref, textOf).map((s) => ({
    ...s,
    text: (textOf(s.line) ?? '').slice(s.from, s.to),
  }));
}

/** `normalizeShotRef` for every shot of a project (line texts from ids.json). */
export function normalizeSpans<P extends { ids: { lines: LineIdEntry[]; shots: ShotRef[] } }>(
  p: P,
): P {
  const shots = normalizeShotRefs(p.ids.shots, textLookup(p.ids.lines));
  return shots === p.ids.shots ? p : { ...p, ids: { ...p.ids, shots } };
}

/** True when any shot uses character offsets (needs format 0.2). */
export function usesSpans(refs: readonly ShotRef[]): boolean {
  return refs.some(hasSpan);
}
