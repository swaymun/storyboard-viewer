/**
 * Moving script lines (and whole shots with their lines) to another place in the script while
 * every line keeps its ID. Used so that shot order and script order stay the same when a user or
 * an agent reorders shots.
 *
 * The script is cut into "units": one per anchorable line (with the character cue it belongs to)
 * plus notes/sections/boneyard as position-only units. Units are reordered and written back as
 * Fountain: blank lines are kept where they were, added at every seam, and character cues are
 * repeated when a dialogue block is split. If a moved line would be read as another element type
 * at its new place (e.g. an all-caps action line that now looks like a character cue), it is
 * forced with the Fountain marker (`!`, `.`, `>`). The result is verified line by line; when it
 * cannot be made to match, the op throws and nothing changes.
 */
import { parseFountain, type FountainElement } from './fountain.js';
import { hashLine, normalizeLine } from './hash.js';
import { SbdEditError, moveShot } from './ops.js';
import { scriptDocument, syncScript } from './project.js';
import { normalizeSpans } from './spans.js';
import type { LineIdEntry, SbdProject, ShotRef } from './types.js';

const fail = (msg: string): never => {
  throw new SbdEditError(msg);
};

interface Unit {
  /** Line ID for anchorable lines; null for notes, sections, boneyard, page breaks… */
  id: string | null;
  el: FountainElement;
  /** Source text of the element's physical lines. */
  raw: string;
  /** Raw character cue line for dialogue / parenthetical units. */
  cue: string | null;
  /** A blank line preceded this element (or its cue) in the original script. */
  blank: boolean;
  /** Position in the original unit list. */
  orig: number;
  /** Fountain marker forced onto the line at its new place. */
  force?: string;
}

const isDialogue = (u: Unit) => u.el.type === 'dialogue' || u.el.type === 'parenthetical';
const FORCE: Partial<Record<string, string>> = {
  action: '!',
  scene_heading: '.',
  transition: '>',
};

function cutUnits(p: SbdProject): { units: Unit[]; prefix: string; tail: string } {
  const doc = scriptDocument(p) ?? fail('The project has no script');
  const source = doc!.source;
  const phys = source.split('\n');
  const rawOf = (el: FountainElement) => phys.slice(el.startLine, el.endLine + 1).join('\n');
  const units: Unit[] = [];
  let prefixEnd: number | null = null;
  let prevEnd = -1; // last physical line of the previous element
  let cue: string | null = null;
  let cueBlank = false;
  let afterCue = false;
  for (const el of doc!.elements) {
    if (el.type === 'title_page') {
      prevEnd = el.endLine;
      continue;
    }
    const blank = prevEnd >= 0 && el.startLine > prevEnd + 1;
    if (prefixEnd === null) prefixEnd = lineOffset(phys, el.startLine);
    if (el.type === 'character') {
      cue = rawOf(el);
      cueBlank = blank;
      afterCue = true;
      prevEnd = el.endLine;
      continue;
    }
    const dialogue = el.type === 'dialogue' || el.type === 'parenthetical';
    const id = el.ordinal !== undefined ? (p.ids.lines[el.ordinal]?.id ?? null) : null;
    units.push({
      id,
      el,
      raw: rawOf(el),
      cue: dialogue ? cue : null,
      // the first line of a dialogue block inherits the blank line above its cue
      blank: dialogue && afterCue ? cueBlank : blank,
      orig: units.length,
    });
    if (!dialogue) cue = null;
    afterCue = false;
    prevEnd = el.endLine;
  }
  const last = doc!.elements.at(-1);
  const tail = last ? source.slice(last.end) : source;
  return { units, prefix: source.slice(0, prefixEnd ?? 0), tail: tail || '\n' };
}

function lineOffset(phys: string[], line: number): number {
  let off = 0;
  for (let i = 0; i < line; i++) off += phys[i]!.length + 1;
  return off;
}

function serialize(units: Unit[], prefix: string, tail: string): string {
  let out = prefix;
  let prev: Unit | null = null;
  for (const u of units) {
    const dlg = isDialogue(u);
    let blank = u.blank;
    if (prev) {
      if (prev.orig !== u.orig - 1) blank = true; // a seam: keep paragraphs apart
      if (isDialogue(prev) !== dlg) blank = true;
      if (dlg && isDialogue(prev) && prev.cue !== u.cue) blank = true;
      const t = u.el.type;
      const pt = prev.el.type;
      if (t === 'scene_heading' || t === 'transition') blank = true;
      if (pt === 'scene_heading' || pt === 'transition') blank = true;
      out += blank ? '\n\n' : '\n';
    }
    const cue = dlg && u.cue && (!prev || blank || !isDialogue(prev) || prev.cue !== u.cue);
    if (cue) out += `${u.cue}\n`;
    out +=
      u.force && !u.raw.trimStart().startsWith(u.force) ? `${u.force}${u.raw.trimStart()}` : u.raw;
    prev = u;
  }
  if (units.length) out = out.replace(/\s+$/, '') + tail;
  return out;
}

/**
 * Rebuilds the script with the units in a new order and maps every line ID onto it. Throws when
 * the reordered script does not parse back into the same lines.
 */
function rebuild(p: SbdProject, order: Unit[], prefix: string, tail: string): SbdProject {
  const expected = order.filter((u) => u.id !== null);
  for (let attempt = 0; attempt < 3; attempt++) {
    const script = serialize(order, prefix, tail);
    const doc = parseFountain(script);
    // First line that does not come back as expected (text or type); force its type and retry.
    const k = expected.findIndex((u, i) => {
      const el = doc.lines[i];
      return !el || el.type !== u.el.type || normalizeLine(el.text) !== normalizeLine(u.el.text);
    });
    let retry = false;
    if (k >= 0) {
      const u = expected[k]!;
      const marker = FORCE[u.el.type];
      if (!marker || u.force) fail('These lines cannot be moved there without changing them');
      u.force = marker;
      retry = true;
    } else if (doc.lines.length !== expected.length) {
      fail('These lines cannot be moved there without changing the script');
    }
    if (retry) continue;
    const old = new Map(p.ids.lines.map((l) => [l.id, l]));
    const lines: LineIdEntry[] = expected.map((u, k) => {
      const el = doc.lines[k]!;
      const prev = old.get(u.id!)!;
      const entry: LineIdEntry = {
        ...prev,
        id: u.id!,
        ordinal: k,
        hash: hashLine(el.text),
        text: el.text,
      };
      entry.type = el.type;
      return entry;
    });
    const ordinal = new Map(lines.map((l) => [l.id, l.ordinal]));
    const shots: ShotRef[] = p.ids.shots.map((s) => ({
      ...s,
      lines: s.lines.toSorted((a, b) => (ordinal.get(a) ?? 0) - (ordinal.get(b) ?? 0)),
    }));
    return syncScript({ ...p, script, ids: { ...p.ids, lines, shots } }).project;
  }
  return fail('These lines cannot be moved there without changing them');
}

export interface MoveLinesTarget {
  /** Put the lines right before this line. */
  before?: string;
  /** Put the lines right after this line. */
  after?: string;
  /** Put the lines at the end of the script. */
  end?: boolean;
}

/**
 * Moves script lines (as a block, in script order) to another place in the script. Every line
 * keeps its ID, shot membership does not change. Notes and sections between moved lines move
 * with them.
 */
export function moveLines(
  p: SbdProject,
  lineIds: readonly string[],
  target: MoveLinesTarget,
): SbdProject {
  const synced = syncScript(p).project;
  const ids = new Set(lineIds);
  if (!ids.size) return p;
  const known = new Set(synced.ids.lines.map((l) => l.id));
  for (const id of ids) if (!known.has(id)) fail(`Unknown line "${id}"`);
  const anchor = target.before ?? target.after;
  if (anchor !== undefined && !known.has(anchor)) fail(`Unknown line "${anchor}"`);
  if (anchor !== undefined && ids.has(anchor)) fail('Lines cannot be moved next to themselves');
  const { units, prefix, tail } = cutUnits(synced);
  // Moved block: the lines plus position-only units sandwiched between moved lines.
  const moving = new Set<Unit>();
  units.forEach((u, i) => {
    if (u.id !== null) {
      if (ids.has(u.id)) moving.add(u);
      return;
    }
    const before = units.slice(0, i).findLast((x) => x.id !== null);
    const after = units.slice(i + 1).find((x) => x.id !== null);
    if (before && after && ids.has(before.id!) && ids.has(after.id!)) moving.add(u);
  });
  const block = units.filter((u) => moving.has(u));
  const rest = units.filter((u) => !moving.has(u));
  let at = rest.length;
  if (target.before !== undefined) at = rest.findIndex((u) => u.id === target.before);
  else if (target.after !== undefined) at = rest.findIndex((u) => u.id === target.after) + 1;
  else if (!target.end) fail('move_lines needs "before", "after" or "end"');
  const order = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  if (order.every((u, i) => u === units[i])) return p;
  return rebuild(synced, order, prefix, tail);
}

/**
 * Moves a shot (like `moveShot`) and, when it has script lines, moves those lines in the script so
 * that script order follows shot order: before the first line of the next shot that has lines,
 * else after the last line of the previous one. Shots without lines only change order.
 */
export function moveShotWithLines(
  p: SbdProject,
  id: string,
  to: { index?: number; after?: string | null },
): SbdProject {
  const moved = moveShot(p, id, to);
  const refs = moved.ids.shots;
  const i = refs.findIndex((r) => r.id === id);
  const own = refs[i]!.lines;
  if (!own.length || moved.script === null) return moved;
  // A line split between this shot and another (character spans) cannot move with only one of
  // them: then only the shot order changes.
  const mineSet = new Set(own);
  if (refs.some((r) => r.id !== id && r.lines.some((l) => mineSet.has(l)))) return moved;
  const ord = new Map(moved.ids.lines.map((l) => [l.id, l.ordinal]));
  const mine = new Set(own);
  const others = (r: ShotRef) => r.lines.filter((l) => !mine.has(l));
  const next = refs.slice(i + 1).find((r) => others(r).length);
  const prev = refs.slice(0, i).findLast((r) => others(r).length);
  const first = (r: ShotRef) => others(r).reduce((a, b) => (ord.get(b)! < ord.get(a)! ? b : a));
  const last = (r: ShotRef) => others(r).reduce((a, b) => (ord.get(b)! > ord.get(a)! ? b : a));
  let target: MoveLinesTarget;
  if (next) target = { before: first(next) };
  else if (prev) target = { after: last(prev) };
  else return moved;
  // Already in place? (all own lines sit between prev's last and next's first line)
  const lo = prev ? ord.get(last(prev))! : -1;
  const hi = next ? ord.get(first(next))! : Infinity;
  const ownOrd = own.map((l) => ord.get(l)!).toSorted((a, b) => a - b);
  const contiguous = ownOrd.every((o, k) => k === 0 || o === ownOrd[k - 1]! + 1);
  if (contiguous && ownOrd[0]! > lo && ownOrd.at(-1)! < hi) return moved;
  return moveLines(moved, own, target);
}

/**
 * Puts script lines into a shot and moves their text to match: right before `before` (a line of
 * that shot), else after the shot's last line, else where the shot sits among the other shots.
 * Lines leave their previous shot. Every line keeps its ID.
 */
export function placeLines(
  p: SbdProject,
  lineIds: readonly string[],
  shotId: string,
  opts: { before?: string } = {},
): SbdProject {
  const ref = p.ids.shots.find((s) => s.id === shotId) ?? fail(`Unknown shot "${shotId}"`);
  const ids = new Set(lineIds);
  if (opts.before !== undefined && !ref!.lines.includes(opts.before))
    fail(`Line "${opts.before}" is not in shot "${shotId}"`);
  const synced = syncScript(p).project;
  const ord = new Map(synced.ids.lines.map((l) => [l.id, l.ordinal]));
  for (const id of ids) if (!ord.has(id)) fail(`Unknown line "${id}"`);
  const others = ref!.lines.filter((l) => !ids.has(l));
  // membership first
  const members = new Set([...others, ...ids]);
  let project: SbdProject = {
    ...synced,
    ids: {
      ...synced.ids,
      shots: synced.ids.shots.map((s) =>
        s.id === shotId
          ? { ...s, lines: [...members] }
          : s.lines.some((l) => ids.has(l))
            ? { ...s, lines: s.lines.filter((l) => !ids.has(l)) }
            : s,
      ),
    },
  };
  let target: MoveLinesTarget | null = null;
  if (opts.before !== undefined && !ids.has(opts.before)) target = { before: opts.before };
  else if (others.length)
    target = { after: others.reduce((a, b) => (ord.get(b)! > ord.get(a)! ? b : a)) };
  if (target) project = moveLines(project, [...ids], target);
  else {
    // the shot had no other lines: place them by shot order
    const i = project.ids.shots.findIndex((s) => s.id === shotId);
    project = moveShotWithLines(project, shotId, { index: i });
  }
  const o2 = new Map(project.ids.lines.map((l) => [l.id, l.ordinal]));
  return normalizeSpans({
    ...project,
    ids: {
      ...project.ids,
      shots: project.ids.shots.map((s) => ({
        ...s,
        lines: s.lines.toSorted((a, b) => o2.get(a)! - o2.get(b)!),
      })),
    },
  });
}
