/**
 * Three-way merge of projects and file-level diffs. Editors use these when an agent (or a hand
 * edit) changes the storyboard on disk while the user has unsaved changes: `base` is the state
 * both sides started from, `ours` the local edits, `theirs` the new state on disk.
 *
 * Objects merge key by key, arrays of objects with an `id` merge item by item (order follows the
 * side that reordered), everything else is atomic. When both sides changed the same value
 * differently, ours wins and the path is reported as a conflict. The script is merged line by line
 * (diff3 over physical lines; every line keeps the ID it has on the side it came from); when both
 * sides changed the same lines, ours wins for the whole script. Shot→line lists merge as sets
 * (lines added or removed on either side) and are cleaned up afterwards.
 */
import { parseFountain } from './fountain.js';
import { hashLine, hashText } from './hash.js';
import { scriptDocument, serializeProject } from './project.js';
import { diffLines, randomLineId, type LineIdEntry } from './reanchor.js';
import { normalizeShotRefs, remapSpansByText, textLookup } from './spans.js';
import { isShotTarget, type SbdProject, type Shot, type ShotRef } from './types.js';

export interface MergeResult {
  project: SbdProject;
  /** Human-readable paths where both sides changed the same thing (ours was kept). */
  conflicts: string[];
}

type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

const isKeyed = (v: Json): v is Array<{ id: string }> =>
  Array.isArray(v) && v.every((x) => isObj(x) && typeof x['id'] === 'string');

function merge3(b: Json, o: Json, t: Json, path: string, conflicts: string[]): Json {
  if (deepEqual(o, t)) return o;
  if (deepEqual(b, o)) return t;
  if (deepEqual(b, t)) return o;
  if (isObj(o) && isObj(t) && (b === undefined || isObj(b))) {
    const base = (b ?? {}) as Record<string, Json>;
    const out: Record<string, Json> = {};
    for (const k of new Set([...Object.keys(o), ...Object.keys(t)])) {
      const v = merge3(base[k], o[k], t[k], path ? `${path}.${k}` : k, conflicts);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (isKeyed(o) && isKeyed(t) && (b === undefined || isKeyed(b)))
    return mergeKeyed((b ?? []) as Array<{ id: string }>, o, t, path, conflicts);
  conflicts.push(path || '(root)');
  return o;
}

function mergeKeyed(
  b: Array<{ id: string }>,
  o: Array<{ id: string }>,
  t: Array<{ id: string }>,
  path: string,
  conflicts: string[],
): Json[] {
  const bm = new Map(b.map((x) => [x.id, x]));
  const om = new Map(o.map((x) => [x.id, x]));
  const tm = new Map(t.map((x) => [x.id, x]));
  const merged = new Map<string, Json>();
  for (const id of new Set([...o.map((x) => x.id), ...t.map((x) => x.id)])) {
    const v = merge3(bm.get(id), om.get(id), tm.get(id), `${path}[${id}]`, conflicts);
    if (v !== undefined) merged.set(id, v);
  }
  // Order: follow the side that reordered common items (ours when both did).
  const common = (list: Array<{ id: string }>) =>
    list.map((x) => x.id).filter((id) => bm.has(id) && om.has(id) && tm.has(id));
  const baseOrder = common(b);
  const oursReordered = !deepEqual(common(o), baseOrder);
  const [main, other] = oursReordered || deepEqual(common(t), baseOrder) ? [o, t] : [t, o];
  const ids = main.map((x) => x.id).filter((id) => merged.has(id));
  // Items only the other side has go after their nearest predecessor in that side's list.
  other.forEach((x, i) => {
    if (ids.includes(x.id) || !merged.has(x.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = ids.indexOf(other[j]!.id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    ids.splice(at, 0, x.id);
  });
  return ids.map((id) => merged.get(id)!);
}

/** Three-way merge of two edited versions of `base`. */
export function mergeProjects(base: SbdProject, ours: SbdProject, theirs: SbdProject): MergeResult {
  const conflicts: string[] = [];
  const m = <T>(b: T, o: T, t: T, path: string): T => merge3(b, o, t, path, conflicts) as T;

  // Script and line IDs travel together.
  let script = ours.script;
  let lines = ours.ids.lines;
  if (ours.script === base.script) {
    script = theirs.script;
    lines = theirs.ids.lines;
  } else if (theirs.script !== base.script && theirs.script !== ours.script) {
    const merged = mergeScripts(base, ours, theirs);
    if (merged) ({ script, lines } = merged);
    else conflicts.push('script.fountain');
  }
  // `modified` is bookkeeping: the newest timestamp wins without a conflict.
  const modified = [ours.manifest.modified, theirs.manifest.modified]
    .filter(Boolean)
    .toSorted()
    .at(-1);
  const withModified = (x: SbdProject['manifest']) =>
    modified && x.modified !== undefined ? { ...x, modified } : x;
  const manifest = m(
    withModified(base.manifest),
    withModified(ours.manifest),
    withModified(theirs.manifest),
    'manifest',
  );

  const { lines: _bl, shots: bRefs, script_hash: _bh, ...bIds } = base.ids;
  const { lines: _ol, shots: oRefs, script_hash: _oh, ...oIds } = ours.ids;
  const { lines: _tl, shots: tRefs, script_hash: _th, ...tIds } = theirs.ids;
  const idsRest = m(bIds, oIds, tIds, 'ids');
  let refs = m(bRefs, oRefs, tRefs, 'ids.shots') as ShotRef[];
  refs = mergeShotLines(bRefs, oRefs, tRefs, refs, lines, conflicts);
  let shots = m(base.shots, ours.shots, theirs.shots, 'shots') as Record<string, Shot>;
  const assets = m(base.assets, ours.assets, theirs.assets, 'assets');
  const timeline = m(base.timeline, ours.timeline, theirs.timeline, 'timeline');

  // Consistency: shot files follow shot refs, refs only point at existing lines.
  const live = new Set(lines.map((l) => l.id));
  const refIds = new Set(refs.map((r) => r.id));
  refs = refs.map((r) =>
    r.lines.every((l) => live.has(l)) ? r : { ...r, lines: r.lines.filter((l) => live.has(l)) },
  );
  // Character spans: each boundary moves with its line's text, from the side it came from.
  const oursText = textLookup(ours.ids.lines);
  const theirsText = textLookup(theirs.ids.lines);
  const mergedText = textLookup(lines);
  const same = (a: unknown, b: unknown) => deepEqual(a, b);
  refs = remapSpansByText(refs, oursText, mergedText, (r, which) => {
    const o = oRefs.find((x) => x.id === r.id)?.[which];
    const t = tRefs.find((x) => x.id === r.id)?.[which];
    return same(r[which], o) || !same(r[which], t) ? oursText : theirsText;
  });
  refs = normalizeShotRefs(refs, mergedText);
  const fixed: Record<string, Shot> = {};
  for (const r of refs) fixed[r.id] = shots[r.id] ?? { id: r.id, variants: [] };
  for (const id of Object.keys(shots))
    if (!refIds.has(id) && !conflicts.some((c) => c.startsWith(`shots.${id}`)))
      conflicts.push(`shots.${id}`);
  shots = fixed;
  timeline.cues = timeline.cues.filter((c) => !isShotTarget(c.target) || refIds.has(c.target.shot));

  const project: SbdProject = {
    manifest,
    script,
    ids: { ...idsRest, script_hash: script === null ? null : hashText(script), shots: refs, lines },
    shots,
    assets,
    timeline,
  };
  return { project, conflicts: [...new Set(conflicts)] };
}

/**
 * Shot→line lists merge as sets: a line is in a shot when it was there in base and neither side
 * removed it, or when either side added it. A line both sides put into different shots stays in
 * ours. Lists are sorted into script order.
 */
function mergeShotLines(
  b: ShotRef[],
  o: ShotRef[],
  t: ShotRef[],
  merged: ShotRef[],
  lines: readonly LineIdEntry[],
  conflicts: string[],
): ShotRef[] {
  const get = (refs: ShotRef[], id: string) => new Set(refs.find((r) => r.id === id)?.lines ?? []);
  const ordinal = new Map(lines.map((l) => [l.id, l.ordinal]));
  const oursOwner = new Map<string, string>();
  for (const r of o) for (const l of r.lines) oursOwner.set(l, r.id);
  const out = merged.map((r) => {
    const bs = get(b, r.id);
    const os = o.some((x) => x.id === r.id) ? get(o, r.id) : bs;
    const ts = t.some((x) => x.id === r.id) ? get(t, r.id) : bs;
    const set = new Set<string>();
    for (const l of bs) if (os.has(l) && ts.has(l)) set.add(l);
    for (const l of os) if (!bs.has(l)) set.add(l);
    for (const l of ts) if (!bs.has(l)) set.add(l);
    return { ...r, lines: [...set] };
  });
  // a line both sides moved into different shots: ours wins. Lines that several shots share on
  // one side (character spans, format 0.2) stay shared.
  const owners = (refs: ShotRef[]) => {
    const m = new Map<string, Set<string>>();
    for (const r of refs)
      for (const l of r.lines) {
        let set = m.get(l);
        if (!set) m.set(l, (set = new Set()));
        set.add(r.id);
      }
    return m;
  };
  const om = owners(o);
  const tm = owners(t);
  const mm = owners(out);
  const within = (a: Set<string>, b: Set<string> | undefined) =>
    !!b && [...a].every((x) => b.has(x));
  for (const [l, set] of mm) {
    if (set.size < 2 || within(set, om.get(l)) || within(set, tm.get(l))) continue;
    const keep = om.get(l) ?? new Set([oursOwner.get(l)]);
    for (const r of out) if (!keep.has(r.id)) r.lines = r.lines.filter((x) => x !== l);
  }
  for (const r of out) r.lines.sort((x, y) => (ordinal.get(x) ?? 0) - (ordinal.get(y) ?? 0));
  for (let i = conflicts.length - 1; i >= 0; i--)
    if (/^ids\.shots\[[^\]]+\]\.lines$/.test(conflicts[i]!)) conflicts.splice(i, 1);
  return out;
}

/**
 * Three-way merge of the script text over physical lines (diff3). Returns null when both sides
 * changed the same region differently. Each anchorable line keeps the ID it has on the side its
 * text came from; IDs used twice (e.g. a line duplicated by both sides) get a new ID.
 */
export function mergeScripts(
  base: SbdProject,
  ours: SbdProject,
  theirs: SbdProject,
): { script: string; lines: LineIdEntry[] } | null {
  const split = (p: SbdProject) => (p.script ?? '').split('\n');
  const B = split(base);
  const O = split(ours);
  const T = split(theirs);
  const mo = new Map(diffLines(B, O));
  const mt = new Map(diffLines(B, T));
  type Src = { side: 'o' | 't'; line: number } | null;
  const text: string[] = [];
  const src: Src[] = [];
  const emit = (side: 'o' | 't', from: string[], a: number, z: number) => {
    for (let k = a; k < z; k++) {
      text.push(from[k]!);
      src.push({ side, line: k });
    }
  };
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  let i = 0;
  let o = 0;
  let t = 0;
  for (;;) {
    let j = i;
    while (j < B.length && !(mo.has(j) && mt.has(j) && mo.get(j)! >= o && mt.get(j)! >= t)) j++;
    if (j === i && j < B.length && mo.get(j) === o && mt.get(j) === t) {
      emit('o', O, o, o + 1);
      i++;
      o++;
      t++;
      continue;
    }
    const oe = j < B.length ? mo.get(j)! : O.length;
    const te = j < B.length ? mt.get(j)! : T.length;
    const bc = B.slice(i, j);
    const oc = O.slice(o, oe);
    const tc = T.slice(t, te);
    if (same(oc, bc)) emit('t', T, t, te);
    else if (same(tc, bc) || same(oc, tc)) emit('o', O, o, oe);
    else return null;
    if (j >= B.length) break;
    i = j;
    o = oe;
    t = te;
  }
  const script = text.join('\n');
  // IDs by provenance: physical line → line ID on each side
  const idsAt = (p: SbdProject) => {
    const doc = scriptDocument(p);
    const map = new Map<number, string>();
    doc?.lines.forEach((el, k) => {
      const id = p.ids.lines[k]?.id;
      if (id) map.set(el.startLine, id);
    });
    return map;
  };
  const oIds = idsAt(ours);
  const tIds = idsAt(theirs);
  const doc = parseFountain(script);
  const taken = new Set<string>();
  const all = new Set([...ours.ids.lines, ...theirs.ids.lines].map((l) => l.id));
  const lines: LineIdEntry[] = doc.lines.map((el, k) => {
    const s = src[el.startLine];
    let id = s ? (s.side === 'o' ? oIds : tIds).get(s.line) : undefined;
    if (!id || taken.has(id)) id = randomLineId(new Set([...all, ...taken]));
    taken.add(id);
    return { id, ordinal: k, hash: hashLine(el.text), text: el.text, type: el.type };
  });
  return { script, lines };
}

/**
 * Text files that differ between two projects: path → new contents, or `null` when the file is
 * gone (removed shots, removed script).
 */
export function diffProjectFiles(
  before: SbdProject | Record<string, string>,
  after: SbdProject | Record<string, string>,
): Record<string, string | null> {
  const a =
    'manifest' in before && isObj(before.manifest)
      ? serializeProject(before as SbdProject)
      : (before as Record<string, string>);
  const b =
    'manifest' in after && isObj(after.manifest)
      ? serializeProject(after as SbdProject)
      : (after as Record<string, string>);
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(b)) if (a[k] !== v) out[k] = v;
  for (const k of Object.keys(a)) if (!(k in b)) out[k] = null;
  return out;
}

/** Hash of a text file's contents (null for a missing file), for optimistic concurrency. */
export function fileVersion(text: string | null | undefined): string | null {
  return text === null || text === undefined ? null : hashText(text);
}
