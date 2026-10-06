/**
 * Where shots sit in the script text: for every shot the exact pieces of text it covers (document
 * positions, one piece per script line, without the space around the words), its start and end,
 * or, for shots without lines, the position of their marker between lines. Pure: computed from
 * the committed project and its script text; the editor maps it through edits made since.
 */
import {
  scriptDocument,
  shotSegments,
  textLookup,
  textOffsetToSource,
  type FountainElement,
  type SbdProject,
  type SpanSide,
} from '@storyboard-viewer/format';

/** One piece of a shot's text on one line: `[from, to)` document positions. */
export interface ShotPiece {
  from: number;
  to: number;
  /** How each end moves while typing (see `mapSpanPos`). */
  fromSide: SpanSide;
  toSide: SpanSide;
}

export interface ShotGeom {
  id: string;
  /** 0-based position in shot order. */
  index: number;
  title: string;
  /** 1–6: which `--shot-N` color. */
  color: number;
  pieces: ShotPiece[];
  /** Covers part of a line (format 0.2 span). */
  partial: boolean;
  /** Shots without lines: marker position and side (-1 = before the line at `anchor`). */
  marker?: { pos: number; side: -1 | 1 };
  /** Hidden by the tag filter. */
  dim: boolean;
}

export interface LineAnchor {
  /** Start of the line's first physical line. */
  pos: number;
  id: string;
}

export interface Annotations {
  shots: ShotGeom[];
  lines: LineAnchor[];
}

/** Line start offsets of a text. */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

export function computeAnnotations(
  p: SbdProject,
  visible: (shotId: string) => boolean = () => true,
): Annotations {
  const text = p.script ?? '';
  const doc = scriptDocument({ script: text })!;
  const starts = lineStarts(text);
  const at = (physLine: number) => starts[Math.min(physLine, starts.length - 1)]!;
  const elOf = new Map<string, FountainElement>();
  const ordinal = new Map<string, number>();
  const lines: LineAnchor[] = [];
  p.ids.lines.forEach((e) => {
    const el = doc.lines[e.ordinal];
    if (!el) return;
    elOf.set(e.id, el);
    ordinal.set(e.id, e.ordinal);
    lines.push({ pos: at(el.startLine), id: e.id });
  });
  const textOf = textLookup(p.ids.lines);

  const shots: ShotGeom[] = [];
  let lastEnd: number | null = null; // last physical line of the previous shot with lines
  p.ids.shots.forEach((ref, index) => {
    const shot = p.shots[ref.id];
    const segs = shotSegments(ref, textOf)
      .filter((s) => elOf.has(s.line))
      .toSorted((a, b) => ordinal.get(a.line)! - ordinal.get(b.line)!);
    const pieces: ShotPiece[] = [];
    segs.forEach((s, k) => {
      const el = elOf.get(s.line)!;
      let from = textOffsetToSource(el, s.from);
      let to = textOffsetToSource(el, s.to);
      // the words only: no space at either end
      while (from < to && /\s/.test(text[from]!)) from++;
      while (to > from && /\s/.test(text[to - 1]!)) to--;
      if (to <= from) return;
      pieces.push({
        from,
        to,
        fromSide: k === 0 && s.from > 0 ? 'start' : 'lineStart',
        toSide: k === segs.length - 1 && !s.whole && s.to < el.text.length ? 'end' : 'lineEnd',
      });
    });
    const g: ShotGeom = {
      id: ref.id,
      index,
      title: shot?.title ?? '',
      color: (index % 6) + 1,
      pieces,
      partial: segs.some((s) => !s.whole),
      dim: !visible(ref.id),
    };
    if (!pieces.length) {
      g.marker =
        lastEnd === null
          ? { pos: 0, side: -1 }
          : { pos: at(lastEnd) + (doc.source.split('\n')[lastEnd]?.length ?? 0), side: 1 };
    } else {
      const last = segs.at(-1)!;
      lastEnd = elOf.get(last.line)!.endLine;
    }
    shots.push(g);
  });
  return { shots, lines };
}

/** Line IDs whose first physical line starts in [from, to] (document positions). */
export function linesInRange(a: Annotations, from: number, to: number): string[] {
  return a.lines.filter((l) => l.pos >= from && l.pos <= to).map((l) => l.id);
}

/** Shots whose text contains `pos` (ends included), the innermost / first first. */
export function shotsAt(a: Annotations, pos: number): string[] {
  return a.shots.filter((s) => s.pieces.some((x) => pos >= x.from && pos <= x.to)).map((s) => s.id);
}

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}'’_-]/u.test(c);

/**
 * Where a boundary moves with ←/→ on a focused handle: by one word (a start lands on the start
 * of a word, an end on the end of one), or by one character (`exact`). `text` is the document.
 */
export function nudgeBoundary(
  text: string,
  pos: number,
  edge: 'start' | 'end',
  dir: -1 | 1,
  exact = false,
): number {
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  if (exact) return clamp(pos + dir);
  let p = pos;
  if (edge === 'start') {
    if (dir < 0) {
      while (p > 0 && !isWord(text[p - 1])) p--;
      while (p > 0 && isWord(text[p - 1])) p--;
    } else {
      while (p < text.length && isWord(text[p])) p++;
      while (p < text.length && !isWord(text[p])) p++;
    }
  } else if (dir > 0) {
    while (p < text.length && !isWord(text[p])) p++;
    while (p < text.length && isWord(text[p])) p++;
  } else {
    while (p > 0 && isWord(text[p - 1])) p--;
    while (p > 0 && !isWord(text[p - 1])) p--;
  }
  return clamp(p);
}
