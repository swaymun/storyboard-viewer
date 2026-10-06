/**
 * Animatic timing: turns shots, lines and cues into absolute start/end times. Pure and shared by
 * the web player and (later) exporters. Rules are documented in SPEC.md "Playback timing".
 */
import { resolveLines } from './project.js';
import { lineSegments, shotSegments } from './spans.js';
import {
  isGlobalTarget,
  isLineTarget,
  isRangeTarget,
  isShotTarget,
  type Cue,
  type SbdProject,
} from './types.js';

export interface AnimaticLine {
  id: string;
  start: number;
  end: number;
  /** True when the duration was estimated from the text (no cue gave a length). */
  estimated: boolean;
  /**
   * Format 0.2: the part of the line this shot covers (`[from, to)` in the line's text) when the
   * line is split between shots. Its time is the line's share for that part.
   */
  from?: number;
  to?: number;
}

export interface AnimaticShot {
  id: string;
  index: number;
  start: number;
  end: number;
  lines: AnimaticLine[];
}

export interface AnimaticCue {
  id: string;
  asset: string;
  /** Absolute story time the cue starts (s). */
  start: number;
  /** Absolute story time it stops (s). */
  end: number;
  /** Source position at `start` (s). */
  in: number;
  /** Source end (s); undefined = play to the end of the media. */
  out?: number;
  gain: number;
  track: string;
  loop: boolean;
  fade_in: number;
  fade_out: number;
}

export interface Animatic {
  duration: number;
  shots: AnimaticShot[];
  cues: AnimaticCue[];
}

export interface AnimaticOptions {
  /** Duration of an asset in seconds when known (asset.duration is used otherwise). */
  assetDuration?: (assetId: string) => number | undefined;
  /** Reading speed used to estimate line durations. Default 2.6 words/s. */
  wordsPerSecond?: number;
}

/** Seconds a line would take without audio. */
export function estimateLineDuration(text: string, type: string | undefined, wps = 2.6): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  switch (type) {
    case 'scene_heading':
      return 1.5;
    case 'transition':
      return 1;
    case 'parenthetical':
      return 0.8;
    default:
      return Math.max(1.2, words / wps + 0.4);
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function buildAnimatic(p: SbdProject, opts: AnimaticOptions = {}): Animatic {
  const wps = opts.wordsPerSecond ?? 2.6;
  const assetById = new Map(p.assets.assets.map((a) => [a.id, a]));
  const durationOf = (id: string) => opts.assetDuration?.(id) ?? assetById.get(id)?.duration;
  const cueLength = (c: Cue): number | undefined => {
    const start = c.in ?? 0;
    const end = c.out ?? durationOf(c.asset);
    return end === undefined ? undefined : Math.max(0, end - start);
  };
  const lineInfo = resolveLines(p);
  const lineCues = new Map<string, Cue[]>();
  const shotCues = new Map<string, Cue[]>();
  for (const c of p.timeline.cues) {
    if (isLineTarget(c.target))
      lineCues.set(c.target.line, [...(lineCues.get(c.target.line) ?? []), c]);
    else if (isShotTarget(c.target))
      shotCues.set(c.target.shot, [...(shotCues.get(c.target.shot) ?? []), c]);
  }
  const fallback = p.manifest.default_shot_duration ?? 3;

  const shots: AnimaticShot[] = [];
  const lineStart = new Map<string, AnimaticLine>();
  let t = 0;
  // A line split between shots (character spans) shares its duration between them in
  // proportion to the characters each one covers.
  const textOf = (id: string) => lineInfo.get(id)?.text;
  const segsByLine = lineSegments(p.ids.shots, textOf);
  const lineLength = (lid: string) => {
    let best: number | undefined;
    for (const c of lineCues.get(lid) ?? []) {
      const len = cueLength(c);
      if (len !== undefined) best = Math.max(best ?? 0, (c.offset ?? 0) + len);
    }
    const info = lineInfo.get(lid);
    return best !== undefined
      ? { len: best, estimated: false }
      : { len: estimateLineDuration(info?.text ?? '', info?.type, wps), estimated: true };
  };
  p.ids.shots.forEach((ref, index) => {
    const shot = p.shots[ref.id];
    const lens = shotSegments(ref, textOf).map((seg) => {
      const lid = seg.line;
      const { len, estimated } = lineLength(lid);
      const all = segsByLine.get(lid) ?? [];
      const out: { id: string; len: number; estimated: boolean; from?: number; to?: number } = {
        id: lid,
        len,
        estimated,
      };
      if (!seg.whole) {
        const total = all.reduce((sum, x) => sum + Math.max(0, x.to - x.from), 0);
        out.len = total > 0 ? (len * (seg.to - seg.from)) / total : len / Math.max(1, all.length);
        out.from = seg.from;
        out.to = seg.to;
      }
      return out;
    });
    const natural = lens.reduce((s, l) => s + l.len, 0);
    let cueExtent = 0;
    for (const c of shotCues.get(ref.id) ?? []) {
      const len = cueLength(c);
      if (len !== undefined) cueExtent = Math.max(cueExtent, (c.offset ?? 0) + len);
    }
    // at least 1.5 s with lines; a shot on part of a line keeps its share (min 0.3 s) so the
    // pictures follow a line's audio
    const partial = lens.some((l) => l.from !== undefined);
    const min = !lens.length ? fallback : partial && lens.length === 1 ? 0.3 : 1.5;
    const total = shot?.duration ?? Math.max(natural, cueExtent, min);
    const scale = natural > total && natural > 0 ? total / natural : 1;
    let lt = t;
    const lines: AnimaticLine[] = lens.map((l) => {
      const line: AnimaticLine = {
        id: l.id,
        start: round(lt),
        end: round(lt + l.len * scale),
        estimated: l.estimated,
      };
      if (l.from !== undefined) {
        line.from = l.from;
        line.to = l.to!;
      }
      lt += l.len * scale;
      // a line's cue starts with the line's first part
      if (!lineStart.has(l.id)) lineStart.set(l.id, line);
      return line;
    });
    shots.push({ id: ref.id, index, start: round(t), end: round(t + total), lines });
    t += total;
  });
  const duration = round(t);
  const shotById = new Map(shots.map((s) => [s.id, s]));

  const cues: AnimaticCue[] = [];
  for (const c of p.timeline.cues) {
    let start: number | undefined;
    const tg = c.target;
    if (isLineTarget(tg)) start = lineStart.get(tg.line)?.start;
    else if (isShotTarget(tg)) start = shotById.get(tg.shot)?.start;
    else if (isRangeTarget(tg)) {
      const a = lineStart.get(tg.range[0]);
      const b = lineStart.get(tg.range[1]);
      start = a && b ? Math.min(a.start, b.start) : (a ?? b)?.start;
    } else if (isGlobalTarget(tg)) start = tg.global.start ?? 0;
    if (start === undefined) continue;
    start += c.offset ?? 0;
    const len = cueLength(c);
    const loop = c.loop ?? false;
    const end = loop || len === undefined ? duration : Math.min(duration, start + len);
    if (end <= start) continue;
    const cue: AnimaticCue = {
      id: c.id,
      asset: c.asset,
      start: round(start),
      end: round(end),
      in: c.in ?? 0,
      gain: c.gain ?? 1,
      track: c.track ?? 'default',
      loop,
      fade_in: c.fade_in ?? 0,
      fade_out: c.fade_out ?? 0,
    };
    if (c.out !== undefined) cue.out = c.out;
    cues.push(cue);
  }
  cues.sort((a, b) => a.start - b.start);
  return { duration, shots, cues };
}

/** The shot and line playing at time `t`. */
export function locate(a: Animatic, t: number): { shot?: AnimaticShot; line?: AnimaticLine } {
  const shot =
    a.shots.find((s) => t >= s.start && t < s.end) ??
    (t >= a.duration ? a.shots.at(-1) : undefined);
  const line = shot?.lines.find((l) => t >= l.start && t < l.end);
  const out: { shot?: AnimaticShot; line?: AnimaticLine } = {};
  if (shot) out.shot = shot;
  if (line) out.line = line;
  return out;
}
