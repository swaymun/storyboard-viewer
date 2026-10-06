/**
 * Edit operations: pure functions `(project, input) → new project`. Shared by the MCP server, the
 * CLI and the web app (M2). Inputs are copied, the old project is never mutated (cheap undo/redo:
 * keep old projects). Invalid input throws `SbdEditError` with a message meant for humans/agents.
 *
 * Ops keep references consistent (e.g. removing a shot drops cues that target it) but do not run
 * full validation; callers run `validateProject` before writing.
 */
import {
  parseFountain,
  textOffsetToSource,
  type FountainDocument,
  type FountainElement,
} from './fountain.js';
import { hashLine, normalizeLine } from './hash.js';
import { newId, isValidId } from './idgen.js';
import { classifySrc } from './media.js';
import { remapShots, scriptDocument, syncScript } from './project.js';
import { randomLineId, reanchorLines, toNewLines, type LineIdEntry } from './reanchor.js';
import {
  carveShots,
  comparePoints,
  hasSpan,
  lineSegments,
  mapSpanPos,
  normalizeShotRef,
  normalizeSpans,
  pointAt,
  shotBounds,
  textChanges,
  textLookup,
  usesSpans,
  type PosChange,
  type ScriptPoint,
} from './spans.js';
import {
  isLineTarget,
  isRangeTarget,
  isShotTarget,
  type Asset,
  type CanvasVariant,
  type Cue,
  type CueTarget,
  type FieldValue,
  type Layer,
  type Manifest,
  type SbdProject,
  type Shot,
  type ShotRef,
  type SpanPoint,
  type TrackDef,
  type Variant,
  type WithOptionalId,
} from './types.js';

export class SbdEditError extends Error {
  override name = 'SbdEditError';
}

const fail = (msg: string): never => {
  throw new SbdEditError(msg);
};

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

function checkNewId(id: string, taken: { has(id: string): boolean }, what: string): void {
  if (!isValidId(id))
    fail(`Invalid ${what} ID "${id}": use letters, digits, "_", "-", "." (max 64)`);
  if (taken.has(id)) fail(`${what} ID "${id}" already exists`);
}

function getShot(p: SbdProject, id: string): Shot {
  const s = p.shots[id];
  if (!s || !p.ids.shots.some((r) => r.id === id)) fail(`Unknown shot "${id}"`);
  return s!;
}

function shotIndex(p: SbdProject, id: string): number {
  const i = p.ids.shots.findIndex((r) => r.id === id);
  if (i < 0) fail(`Unknown shot "${id}"`);
  return i;
}

function allIds(p: SbdProject): Set<string> {
  return new Set(p.ids.shots.map((s) => s.id));
}

// ---------------------------------------------------------------------------
// Manifest

export function updateManifest(p: SbdProject, patch: Partial<Manifest>): SbdProject {
  const manifest = { ...p.manifest, ...clone(patch) } as Manifest;
  for (const [k, v] of Object.entries(patch)) if (v === null) delete manifest[k];
  if (patch.format && patch.format !== 'sbd') fail('format must be "sbd"');
  return { ...p, manifest };
}

// ---------------------------------------------------------------------------
// Shots

export interface AddShotInput {
  /** Optional readable ID (letters, digits, `_-.`); generated (`s_xxxxxx`) when omitted. */
  id?: string;
  title?: string;
  fields?: Record<string, FieldValue>;
  duration?: number;
  tags?: string[];
  lines?: string[];
  /** Format 0.2: the shot starts at this character of a line (default: start of its first line). */
  start?: SpanPoint;
  /** Format 0.2: the shot ends before this character of a line (default: end of its last line). */
  end?: SpanPoint;
  variants?: VariantInput[];
  active_variant?: string;
  /** Insert after this shot; `null` = at the start; omitted = at the end. */
  after?: string | null;
  /** Insert at this 0-based index (alternative to `after`). */
  index?: number;
}

export function addShot(
  p: SbdProject,
  input: AddShotInput = {},
): { project: SbdProject; id: string } {
  const taken = allIds(p);
  const id = input.id ?? newId('s', { has: (x) => taken.has(x) || x in p.shots });
  checkNewId(id, { has: (x) => taken.has(x) || x in p.shots }, 'Shot');
  const shot: Shot = { id };
  if (input.title !== undefined) shot.title = input.title;
  shot.fields = clone(input.fields) ?? {};
  if (input.duration !== undefined) shot.duration = checkDuration(input.duration);
  if (input.tags) shot.tags = [...input.tags];
  shot.variants = [];
  let project: SbdProject = { ...p, shots: { ...p.shots, [id]: shot } };
  let index = p.ids.shots.length;
  if (input.index !== undefined) index = Math.max(0, Math.min(input.index, p.ids.shots.length));
  else if (input.after === null) index = 0;
  else if (input.after !== undefined) index = shotIndex(p, input.after) + 1;
  const refs = [...p.ids.shots];
  refs.splice(index, 0, { id, lines: [] });
  project = { ...project, ids: { ...p.ids, shots: refs } };
  for (const v of input.variants ?? []) project = addVariant(project, id, v).project;
  if (input.active_variant) project = setActiveVariant(project, id, input.active_variant);
  if (input.start || input.end) project = setShotSpanFrom(project, id, input);
  else if (input.lines?.length) project = setShotLines(project, id, input.lines);
  return { project, id };
}

/** `start` / `end` with defaults from `lines` (first line's start, last line's end). */
function setShotSpanFrom(
  p: SbdProject,
  id: string,
  input: { lines?: readonly string[]; start?: SpanPoint; end?: SpanPoint },
): SbdProject {
  const ord = new Map(p.ids.lines.map((l) => [l.id, l.ordinal]));
  const sorted = [...(input.lines ?? [])].toSorted((a, b) => (ord.get(a) ?? 0) - (ord.get(b) ?? 0));
  const textOf = textLookup(p.ids.lines);
  const first = input.start?.line ?? sorted[0];
  const last = input.end?.line ?? sorted.at(-1);
  if (!first || !last) fail('Give lines, or both start and end');
  const start = input.start ?? { line: first!, offset: 0 };
  const end = input.end ?? { line: last!, offset: textOf(last!)?.length ?? 0 };
  return setShotSpan(p, id, start, end);
}

/** Spans need format 0.2: bump an older `format_version`. */
function withSpanVersion(p: SbdProject): SbdProject {
  if (!usesSpans(p.ids.shots)) return p;
  const [maj, min] = (p.manifest.format_version ?? '0.1.0').split('.').map(Number);
  if ((maj ?? 0) > 0 || (min ?? 0) >= 2) return p;
  return { ...p, manifest: { ...p.manifest, format_version: '0.2.0' } };
}

/**
 * Format 0.2: makes a shot cover exactly the text from `start` to `end` (exclusive), which may be
 * part of one line, several shots in one line, or several lines. The text is taken out of other
 * shots (shots never overlap); a shot losing text in its middle keeps the part before.
 */
export function setShotSpan(
  p: SbdProject,
  id: string,
  start: SpanPoint,
  end: SpanPoint,
): SbdProject {
  const i = shotIndex(p, id);
  const entries = p.ids.lines;
  const ord = new Map(entries.map((l) => [l.id, l.ordinal]));
  const textOf = textLookup(entries);
  for (const pt of [start, end]) {
    if (!pt || typeof pt.line !== 'string' || !ord.has(pt.line)) fail(`Unknown line "${pt?.line}"`);
    if (!Number.isInteger(pt.offset) || pt.offset < 0)
      fail('Offsets are character positions (whole numbers >= 0)');
  }
  const clampTo = (pt: SpanPoint): ScriptPoint => ({
    ordinal: ord.get(pt.line)!,
    offset: Math.min(pt.offset, textOf(pt.line)?.length ?? 0),
  });
  const S = clampTo(start);
  const E = clampTo(end);
  if (comparePoints(S, E) >= 0) fail('The span is empty: its end must come after its start');
  const byOrd = entries.toSorted((a, b) => a.ordinal - b.ordinal);
  const lines = byOrd
    .filter((l) => l.ordinal >= S.ordinal && l.ordinal <= E.ordinal)
    .map((l) => l.id);
  const shots = carveShots(p.ids.shots, id, S, E, entries);
  const { start: _s, end: _e, ...rest } = shots[i]!;
  shots[i] = normalizeShotRef(
    {
      ...rest,
      lines,
      start: { line: lines[0]!, offset: S.offset },
      end: { line: lines.at(-1)!, offset: E.offset },
    },
    textOf,
  );
  return withSpanVersion({ ...p, ids: { ...p.ids, shots } });
}

function checkDuration(d: number): number {
  if (!(typeof d === 'number' && Number.isFinite(d) && d > 0))
    fail('duration must be a number of seconds > 0');
  return d;
}

export interface UpdateShotInput {
  title?: string | null;
  /** Merged into existing fields; a `null` value deletes that field. */
  fields?: Record<string, FieldValue>;
  duration?: number | null;
  tags?: string[] | null;
  active_variant?: string | null;
  /** Any other custom top-level properties (null deletes). */
  [key: string]: unknown;
}

export function updateShot(p: SbdProject, id: string, patch: UpdateShotInput): SbdProject {
  const old = getShot(p, id);
  const shot: Shot = clone(old);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === 'id' || key === 'variants' || key === 'lines') {
      fail(`update_shot cannot change "${key}" (use the dedicated operation)`);
    } else if (key === 'fields') {
      const fields = { ...shot.fields };
      for (const [k, v] of Object.entries(value as Record<string, FieldValue>)) {
        if (v === null) delete fields[k];
        else fields[k] = v;
      }
      shot.fields = fields;
    } else if (key === 'duration') {
      if (value === null) delete shot.duration;
      else shot.duration = checkDuration(value as number);
    } else if (key === 'active_variant') {
      if (value === null) delete shot.active_variant;
      else {
        if (!(shot.variants ?? []).some((v) => v.id === value))
          fail(`Shot "${id}" has no variant "${String(value)}"`);
        shot.active_variant = value as string;
      }
    } else if (value === null) delete shot[key];
    else shot[key] = clone(value);
  }
  return { ...p, shots: { ...p.shots, [id]: shot } };
}

/** Moves a shot to `index` (0-based, in the final order) or right after `after` (`null` = start). */
export function moveShot(
  p: SbdProject,
  id: string,
  to: { index?: number; after?: string | null },
): SbdProject {
  const from = shotIndex(p, id);
  const refs = [...p.ids.shots];
  const [ref] = refs.splice(from, 1);
  let index: number;
  if (to.index !== undefined) index = to.index;
  else if (to.after === null) index = 0;
  else if (to.after !== undefined) {
    if (to.after === id) fail('A shot cannot be moved after itself');
    const i = refs.findIndex((r) => r.id === to.after);
    if (i < 0) fail(`Unknown shot "${to.after}"`);
    index = i + 1;
  } else fail('move_shot needs "index" or "after"');
  index = Math.max(0, Math.min(index!, refs.length));
  refs.splice(index, 0, ref!);
  return { ...p, ids: { ...p.ids, shots: refs } };
}

/** Removes a shot. Its lines become unassigned; cues targeting the shot are removed. */
export function removeShot(
  p: SbdProject,
  id: string,
): { project: SbdProject; removedCues: string[] } {
  shotIndex(p, id);
  const shots = { ...p.shots };
  delete shots[id];
  const removedCues = p.timeline.cues
    .filter((c) => isShotTarget(c.target) && c.target.shot === id)
    .map((c) => c.id);
  return {
    project: {
      ...p,
      shots,
      ids: { ...p.ids, shots: p.ids.shots.filter((r) => r.id !== id) },
      timeline: { ...p.timeline, cues: p.timeline.cues.filter((c) => !removedCues.includes(c.id)) },
    },
    removedCues,
  };
}

/**
 * Sets the script lines covered by a shot (sorted into script order). By default the lines are
 * removed from any other shot so each line belongs to one shot (`exclusive: false` to allow
 * sharing). A character span (`start` / `end`) stays while its line is still the first / last
 * line; `whole: true` makes the shot cover whole lines.
 */
export function setShotLines(
  p: SbdProject,
  id: string,
  lineIds: readonly string[],
  opts: { exclusive?: boolean; whole?: boolean } = {},
): SbdProject {
  shotIndex(p, id);
  const ordinal = new Map(p.ids.lines.map((l) => [l.id, l.ordinal]));
  for (const l of lineIds) if (!ordinal.has(l)) fail(`Unknown line "${l}"`);
  const unique = [...new Set(lineIds)].sort((a, b) => ordinal.get(a)! - ordinal.get(b)!);
  const set = new Set(unique);
  const exclusive = opts.exclusive ?? true;
  const shots: ShotRef[] = p.ids.shots.map((r) => {
    if (r.id === id) {
      if (!opts.whole) return { ...r, lines: unique };
      const { start: _s, end: _e, ...rest } = r;
      return { ...rest, lines: unique };
    }
    if (exclusive && r.lines.some((l) => set.has(l)))
      return { ...r, lines: r.lines.filter((l) => !set.has(l)) };
    return r;
  });
  return normalizeSpans({ ...p, ids: { ...p.ids, shots } });
}

/** Line IDs from `from` to `to` inclusive, in script order. */
export function lineRange(p: SbdProject, from: string, to: string): string[] {
  const a = p.ids.lines.find((l) => l.id === from) ?? fail(`Unknown line "${from}"`);
  const b = p.ids.lines.find((l) => l.id === to) ?? fail(`Unknown line "${to}"`);
  const [lo, hi] = a!.ordinal <= b!.ordinal ? [a!.ordinal, b!.ordinal] : [b!.ordinal, a!.ordinal];
  return p.ids.lines.filter((l) => l.ordinal >= lo && l.ordinal <= hi).map((l) => l.id);
}

// ---------------------------------------------------------------------------
// Variants

export type VariantInput = WithOptionalId<Variant>;

export function addVariant(
  p: SbdProject,
  shotId: string,
  input: VariantInput,
  opts: { activate?: boolean; index?: number } = {},
): { project: SbdProject; id: string } {
  const old = getShot(p, shotId);
  const variants = [...(old.variants ?? [])];
  const taken = new Set(variants.map((v) => v.id));
  const id = input.id ?? newId('v', taken);
  checkNewId(id, taken, 'Variant');
  const v = { ...clone(input), id } as Variant;
  if (v.type === 'image') {
    if (!v.asset) fail('An image variant needs "asset" (an image asset ID)');
  } else if (v.type === 'canvas') {
    v.layers = (v.layers ?? []).map((l) => ({ ...l, id: l.id ?? newId('ly', new Set()) }));
    const lids = new Set<string>();
    for (const l of v.layers) {
      checkNewId(l.id, lids, 'Layer');
      lids.add(l.id);
    }
  } else fail('Variant "type" must be "image" or "canvas"');
  const assetsUsed = v.type === 'image' ? [v.asset] : v.layers.map((l) => l.asset);
  for (const a of assetsUsed)
    if (!p.assets.assets.some((x) => x.id === a)) fail(`Unknown asset "${a}"`);
  const index = opts.index ?? variants.length;
  variants.splice(index, 0, v);
  const shot: Shot = { ...old, variants };
  if (opts.activate || !shot.active_variant) shot.active_variant = id;
  return { project: { ...p, shots: { ...p.shots, [shotId]: shot } }, id };
}

export function updateVariant(
  p: SbdProject,
  shotId: string,
  variantId: string,
  patch: Partial<Variant>,
): SbdProject {
  const old = getShot(p, shotId);
  const variants = (old.variants ?? []).map((v) => {
    if (v.id !== variantId) return v;
    const next = { ...v, ...clone(patch), id: v.id } as Variant;
    for (const [k, val] of Object.entries(patch))
      if (val === null) delete (next as Record<string, unknown>)[k];
    return next;
  });
  if (!(old.variants ?? []).some((v) => v.id === variantId))
    fail(`Shot "${shotId}" has no variant "${variantId}"`);
  return { ...p, shots: { ...p.shots, [shotId]: { ...old, variants } } };
}

export function removeVariant(p: SbdProject, shotId: string, variantId: string): SbdProject {
  const old = getShot(p, shotId);
  if (!(old.variants ?? []).some((v) => v.id === variantId))
    fail(`Shot "${shotId}" has no variant "${variantId}"`);
  const variants = (old.variants ?? []).filter((v) => v.id !== variantId);
  const shot: Shot = { ...old, variants };
  if (shot.active_variant === variantId) {
    if (variants[0]) shot.active_variant = variants[0].id;
    else delete shot.active_variant;
  }
  return { ...p, shots: { ...p.shots, [shotId]: shot } };
}

export function setActiveVariant(p: SbdProject, shotId: string, variantId: string): SbdProject {
  const old = getShot(p, shotId);
  if (!(old.variants ?? []).some((v) => v.id === variantId))
    fail(`Shot "${shotId}" has no variant "${variantId}"`);
  return { ...p, shots: { ...p.shots, [shotId]: { ...old, active_variant: variantId } } };
}

// ---------------------------------------------------------------------------
// Assets

export type AssetInput = WithOptionalId<Asset>;

export function addAsset(p: SbdProject, input: AssetInput): { project: SbdProject; id: string } {
  const taken = new Set(p.assets.assets.map((a) => a.id));
  const id = input.id ?? newId('a', taken);
  checkNewId(id, taken, 'Asset');
  if (!classifySrc(input.src))
    fail(
      `Invalid src ${JSON.stringify(input.src)}: use media/<file>, file:<relative path> or https://…`,
    );
  if (!['image', 'audio', 'video', 'font'].includes(input.kind))
    fail('kind must be image, audio, video or font');
  const asset = { ...clone(input), id } as Asset;
  return { project: { ...p, assets: { ...p.assets, assets: [...p.assets.assets, asset] } }, id };
}

export function updateAsset(p: SbdProject, id: string, patch: Partial<Asset>): SbdProject {
  const i = p.assets.assets.findIndex((a) => a.id === id);
  if (i < 0) fail(`Unknown asset "${id}"`);
  if (patch.id !== undefined && patch.id !== id) fail('Asset IDs cannot be changed');
  if (patch.src !== undefined && !classifySrc(patch.src))
    fail(`Invalid src ${JSON.stringify(patch.src)}`);
  const next = { ...p.assets.assets[i]!, ...clone(patch), id } as Asset;
  for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k];
  const assets = [...p.assets.assets];
  assets[i] = next;
  return { ...p, assets: { ...p.assets, assets } };
}

/** Where an asset is used (variants, layers, previews, cues). */
export function assetReferences(p: SbdProject, id: string): string[] {
  const refs: string[] = [];
  for (const [sid, shot] of Object.entries(p.shots)) {
    for (const v of shot.variants ?? []) {
      if (v.type === 'image' && v.asset === id) refs.push(`shot ${sid} variant ${v.id}`);
      if (v.type === 'canvas') {
        if (v.preview === id) refs.push(`shot ${sid} variant ${v.id} preview`);
        for (const l of v.layers)
          if (l.asset === id) refs.push(`shot ${sid} variant ${v.id} layer ${l.id}`);
      }
    }
  }
  for (const c of p.timeline.cues) if (c.asset === id) refs.push(`cue ${c.id}`);
  return refs;
}

/**
 * Removes an asset. Fails while it is still used unless `force` is set, in which case image
 * variants, layers and cues using it are removed as well. Media files are not deleted here.
 */
export function removeAsset(p: SbdProject, id: string, opts: { force?: boolean } = {}): SbdProject {
  if (!p.assets.assets.some((a) => a.id === id)) fail(`Unknown asset "${id}"`);
  const refs = assetReferences(p, id);
  if (refs.length && !opts.force)
    fail(`Asset "${id}" is still used by: ${refs.join(', ')}. Pass force to remove those too.`);
  const shots: Record<string, Shot> = {};
  for (const [sid, shot] of Object.entries(p.shots)) {
    if (
      !(shot.variants ?? []).some((v) =>
        v.type === 'image'
          ? v.asset === id
          : v.preview === id || v.layers.some((l) => l.asset === id),
      )
    ) {
      shots[sid] = shot;
      continue;
    }
    const variants = (shot.variants ?? [])
      .filter((v) => !(v.type === 'image' && v.asset === id))
      .map((v) => {
        if (v.type !== 'canvas') return v;
        const nv = { ...v, layers: v.layers.filter((l) => l.asset !== id) };
        if (nv.preview === id) delete nv.preview;
        return nv;
      });
    const ns: Shot = { ...shot, variants };
    if (ns.active_variant && !variants.some((v) => v.id === ns.active_variant)) {
      if (variants[0]) ns.active_variant = variants[0].id;
      else delete ns.active_variant;
    }
    shots[sid] = ns;
  }
  return {
    ...p,
    shots,
    assets: { ...p.assets, assets: p.assets.assets.filter((a) => a.id !== id) },
    timeline: { ...p.timeline, cues: p.timeline.cues.filter((c) => c.asset !== id) },
  };
}

// ---------------------------------------------------------------------------
// Cues

export type CueInput = WithOptionalId<Cue>;

function checkCue(p: SbdProject, c: Cue): void {
  const a = p.assets.assets.find((x) => x.id === c.asset);
  if (!a) fail(`Unknown asset "${c.asset}"`);
  if (a!.kind !== 'audio' && a!.kind !== 'video')
    fail(`Asset "${c.asset}" is ${a!.kind}; cues need audio or video`);
  checkTarget(p, c.target);
  if (c.in !== undefined && (!Number.isFinite(c.in) || c.in < 0)) fail('"in" must be seconds >= 0');
  if (c.out !== undefined && (!Number.isFinite(c.out) || c.out <= (c.in ?? 0)))
    fail('"out" must be greater than "in"');
  if (c.gain !== undefined && (!Number.isFinite(c.gain) || c.gain < 0)) fail('"gain" must be >= 0');
}

function checkTarget(p: SbdProject, t: CueTarget): void {
  const lines = new Set(p.ids.lines.map((l) => l.id));
  if (!t || typeof t !== 'object') fail('target is required');
  const keys = Object.keys(t);
  if (keys.length !== 1) fail('target must have exactly one of "line", "shot", "range", "global"');
  if (isLineTarget(t)) {
    if (!lines.has(t.line)) fail(`Unknown line "${t.line}"`);
  } else if (isShotTarget(t)) {
    if (!p.ids.shots.some((s) => s.id === t.shot)) fail(`Unknown shot "${t.shot}"`);
  } else if (isRangeTarget(t)) {
    if (t.range.length !== 2) fail('range must be [firstLineId, lastLineId]');
    for (const l of t.range) if (!lines.has(l)) fail(`Unknown line "${l}"`);
  } else if (!('global' in t))
    fail('target must have exactly one of "line", "shot", "range", "global"');
}

export function addCue(p: SbdProject, input: CueInput): { project: SbdProject; id: string } {
  const taken = new Set(p.timeline.cues.map((c) => c.id));
  const id = input.id ?? newId('c', taken);
  checkNewId(id, taken, 'Cue');
  const cue = { ...clone(input), id } as Cue;
  checkCue(p, cue);
  return { project: { ...p, timeline: { ...p.timeline, cues: [...p.timeline.cues, cue] } }, id };
}

export function updateCue(
  p: SbdProject,
  id: string,
  patch: Partial<Cue> & Record<string, unknown>,
): SbdProject {
  const i = p.timeline.cues.findIndex((c) => c.id === id);
  if (i < 0) fail(`Unknown cue "${id}"`);
  const next = { ...p.timeline.cues[i]!, ...clone(patch), id } as Cue;
  for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k];
  checkCue(p, next);
  const cues = [...p.timeline.cues];
  cues[i] = next;
  return { ...p, timeline: { ...p.timeline, cues } };
}

export function removeCue(p: SbdProject, id: string): SbdProject {
  if (!p.timeline.cues.some((c) => c.id === id)) fail(`Unknown cue "${id}"`);
  return { ...p, timeline: { ...p.timeline, cues: p.timeline.cues.filter((c) => c.id !== id) } };
}

// ---------------------------------------------------------------------------
// Script

export interface ScriptEditResult {
  project: SbdProject;
  /** IDs of lines created by the edit. */
  added: string[];
  /** IDs of lines that no longer exist. */
  removed: string[];
  /** Cues removed because their line disappeared. */
  removedCues: string[];
}

/**
 * Replaces the whole script. Line IDs are re-anchored (unchanged lines keep their IDs, edited
 * lines usually do, see SPEC.md); new lines are placed into surrounding shots.
 */
export function setScript(p: SbdProject, script: string | null): ScriptEditResult {
  if (script === p.script) return { project: p, added: [], removed: [], removedCues: [] };
  if (script === null) {
    const removed = p.ids.lines.map((l) => l.id);
    return finishScriptEdit(
      {
        ...p,
        script: null,
        ids: {
          ...p.ids,
          script_hash: null,
          lines: [],
          shots: p.ids.shots.map((s) => ({ ...s, lines: [] })),
        },
      },
      [],
      removed,
    );
  }
  const synced = syncScript({ ...p, script });
  const r = synced.reanchor;
  return finishScriptEdit(synced.project, r?.added ?? [], r?.removed ?? []);
}

function finishScriptEdit(input: SbdProject, added: string[], removed: string[]): ScriptEditResult {
  const p = normalizeSpans(input);
  if (!removed.length) return { project: p, added, removed, removedCues: [] };
  const gone = new Set(removed);
  const removedCues: string[] = [];
  const cues = p.timeline.cues.filter((c) => {
    const t = c.target;
    const dead =
      (isLineTarget(t) && gone.has(t.line)) ||
      (isRangeTarget(t) && t.range.some((l) => gone.has(l)));
    if (dead) removedCues.push(c.id);
    return !dead;
  });
  const shots = p.ids.shots.map((s) =>
    s.lines.some((l) => gone.has(l)) ? { ...s, lines: s.lines.filter((l) => !gone.has(l)) } : s,
  );
  return {
    project: normalizeSpans({ ...p, ids: { ...p.ids, shots }, timeline: { ...p.timeline, cues } }),
    added,
    removed,
    removedCues,
  };
}

/** [start, end) source offsets of the blank-line separated paragraph containing `el`. */
function paragraphBounds(source: string, el: FountainElement): { start: number; end: number } {
  let start = el.start;
  while (start > 0) {
    const prevEnd = source.lastIndexOf('\n', start - 1);
    const lineStart = source.lastIndexOf('\n', prevEnd - 1) + 1;
    if (prevEnd < 0) {
      start = 0;
      break;
    }
    const text = source.slice(lineStart, prevEnd).trim();
    if (!text) break;
    start = lineStart;
  }
  let end = el.end;
  for (;;) {
    const nl = source.indexOf('\n', end);
    if (nl < 0) break;
    const nextNl = source.indexOf('\n', nl + 1);
    const lineEnd = nextNl < 0 ? source.length : nextNl;
    const text = source.slice(nl + 1, lineEnd).replace(/\r$/, '');
    if (!text.trim()) break;
    end = lineEnd;
  }
  return { start, end };
}

function lineElement(
  p: SbdProject,
  lineId: string,
): { entry: LineIdEntry; el: FountainElement; doc: FountainDocument } {
  const entry = p.ids.lines.find((l) => l.id === lineId) ?? fail(`Unknown line "${lineId}"`);
  const doc = scriptDocument(p) ?? fail('The project has no script');
  const el = doc!.lines[entry!.ordinal] ?? fail(`Line "${lineId}" is out of sync with the script`);
  return { entry: entry!, el: el!, doc: doc! };
}

/**
 * Re-anchors after a local edit: old source [editStart, oldEnd) became [editStart, newEnd). Lines
 * fully outside the edit keep their IDs by position (verified by text); the edited region is
 * matched by position when the line count is unchanged, by similarity otherwise.
 */
function applyLocalEdit(
  p: SbdProject,
  newScript: string,
  editStart: number,
  oldEnd: number,
  newEnd: number,
  /** The exact changes (old coordinates) when the edit is several changes; for span mapping. */
  changes: readonly PosChange[] = [
    {
      from: editStart,
      to: oldEnd,
      length: newEnd - editStart,
      text: newScript.slice(editStart, newEnd),
    },
  ],
): { project: SbdProject; added: string[]; removed: string[] } {
  const oldDoc = scriptDocument(p)!;
  const newDoc = parseFountain(newScript);
  const delta = newEnd - oldEnd;
  const oldEntries = p.ids.lines;
  const classify = (el: FountainElement, end: number) =>
    el.end <= editStart ? 'pre' : el.start >= end ? 'post' : 'mid';
  const oldPre: number[] = [];
  const oldMid: number[] = [];
  const oldPost: number[] = [];
  oldDoc.lines.forEach((el, i) => {
    const c = classify(el, oldEnd);
    (c === 'pre' ? oldPre : c === 'mid' ? oldMid : oldPost).push(i);
  });
  const newPre: number[] = [];
  const newMid: number[] = [];
  const newPost: number[] = [];
  newDoc.lines.forEach((el, j) => {
    const c = classify(el, newEnd);
    (c === 'pre' ? newPre : c === 'mid' ? newMid : newPost).push(j);
  });
  const same = (i: number, j: number) =>
    normalizeLine(oldDoc.lines[i]!.text) === normalizeLine(newDoc.lines[j]!.text) &&
    oldDoc.lines[i]!.type === newDoc.lines[j]!.type;
  const ok =
    oldEntries.length === oldDoc.lines.length &&
    oldPre.length === newPre.length &&
    oldPost.length === newPost.length &&
    oldPre.every((i, k) => same(i, newPre[k]!)) &&
    oldPost.every(
      (i, k) =>
        same(i, newPost[k]!) && oldDoc.lines[i]!.start + delta === newDoc.lines[newPost[k]!]!.start,
    );

  let entries: LineIdEntry[];
  let added: string[];
  let removed: string[];
  if (ok) {
    const ids: string[] = Array.from({ length: newDoc.lines.length }, () => '');
    oldPre.forEach((i, k) => (ids[newPre[k]!] = oldEntries[i]!.id));
    oldPost.forEach((i, k) => (ids[newPost[k]!] = oldEntries[i]!.id));
    added = [];
    removed = [];
    if (oldMid.length === newMid.length) {
      oldMid.forEach((i, k) => (ids[newMid[k]!] = oldEntries[i]!.id));
    } else {
      const sub = reanchorLines(
        oldMid.map((i, k) => ({ ...oldEntries[i]!, ordinal: k })),
        newMid.map((j) => ({ text: newDoc.lines[j]!.text, type: newDoc.lines[j]!.type })),
        { newId: (t) => randomLineId(new Set([...t, ...oldEntries.map((e) => e.id)])) },
      );
      sub.entries.forEach((e, k) => (ids[newMid[k]!] = e.id));
      added = sub.added;
      removed = sub.removed.map((r) => r.id);
    }
    entries = newDoc.lines.map((el, j) => ({
      id: ids[j]!,
      ordinal: j,
      hash: hashLine(el.text),
      text: el.text,
      type: el.type,
    }));
  } else {
    const r = reanchorLines(oldEntries, toNewLines(newDoc));
    entries = r.entries;
    added = r.added;
    removed = r.removed.map((x) => x.id);
  }
  const live = new Set(entries.map((e) => e.id));
  const oldOrd = new Map(oldEntries.map((e) => [e.id, e.ordinal]));
  const shots = p.ids.shots.map((s) =>
    hasSpan(s) && s.lines.length
      ? mapShotSpan(s, oldDoc, newDoc, oldOrd, entries, changes)
      : { ...s, lines: s.lines.filter((l) => live.has(l)) },
  );
  const project = { ...p, script: newScript, ids: { ...p.ids, lines: entries, shots } };
  // keep ids.script_hash consistent so loadProject will not re-anchor again
  return { project: syncScript(project).project, added, removed };
}

/**
 * A shot with a character span after a local edit: its boundaries move with the text (see
 * `mapSpanPos`); a boundary without an offset (whole first / last line) stays on its line's edge.
 * The shot then covers the lines from its new start to its new end.
 */
function mapShotSpan(
  ref: ShotRef,
  oldDoc: FountainDocument,
  newDoc: FountainDocument,
  oldOrd: ReadonlyMap<string, number>,
  entries: readonly LineIdEntry[],
  changes: readonly PosChange[],
): ShotRef {
  const { start: st, end: en, ...rest } = ref;
  const firstId = ref.lines[0]!;
  const lastId = ref.lines.at(-1)!;
  const firstEl = oldDoc.lines[oldOrd.get(firstId) ?? -1];
  const lastEl = oldDoc.lines[oldOrd.get(lastId) ?? -1];
  const empty: ShotRef = { ...rest, lines: [] };
  if (!firstEl || !lastEl) return empty;
  const explicitStart = st?.line === firstId;
  const explicitEnd = en?.line === lastId;
  const a0 = textOffsetToSource(firstEl, explicitStart ? st!.offset : 0);
  const z0 = textOffsetToSource(lastEl, explicitEnd ? en!.offset : lastEl.text.length);
  const a = pointAt(
    newDoc,
    mapSpanPos(a0, changes, explicitStart ? 'start' : 'lineStart'),
    'start',
  );
  const z = pointAt(newDoc, mapSpanPos(z0, changes, explicitEnd ? 'end' : 'lineEnd'), 'end');
  if (!a || !z || comparePoints(a, z) > 0) return empty;
  const lines = entries.slice(a.ordinal, z.ordinal + 1).map((e) => e.id);
  if (!lines.length) return empty;
  // offsets that end up on a line edge are dropped by normalizeShotRef (whole line again)
  return {
    ...rest,
    lines,
    start: { line: lines[0]!, offset: a.offset },
    end: { line: lines.at(-1)!, offset: z.offset },
  };
}

function withHash(p: SbdProject): SbdProject {
  return syncScript(p).project;
}

export interface InsertLinesInput {
  /** Fountain text to insert as a new paragraph, e.g. "MAYA\nWe're late." or "INT. GARAGE - NIGHT". */
  text: string;
  /** Insert after the paragraph that contains this line. */
  after_line?: string;
  /** Insert before the paragraph that contains this line. */
  before_line?: string;
  /** Attach the new lines to this shot (defaults to the shot of after_line/before_line). */
  shot?: string;
}

/**
 * Inserts Fountain text as a new paragraph. Existing line IDs never change. Without a position
 * the text goes after the last line of `shot` (or after the previous shots' lines), else at the
 * end of the script.
 */
export function insertScriptLines(p: SbdProject, input: InsertLinesInput): ScriptEditResult {
  const text = input.text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  if (!text.trim()) fail('text is empty');
  const source = p.script ?? '';
  let pos: number;
  let insert: string;
  let shot = input.shot;
  if (shot) shotIndex(p, shot);
  const segs = lineSegments(p.ids.shots, textLookup(p.ids.lines));
  // the shot at the end of the line (after it) / at its start (before it)
  const ownerAfter = (lid: string) => segs.get(lid)?.at(-1)?.shot;
  const ownerBefore = (lid: string) => segs.get(lid)?.[0]?.shot;
  let anchorAfter = input.after_line;
  if (!anchorAfter && !input.before_line && shot) {
    const idx = shotIndex(p, shot);
    for (let i = idx; i >= 0 && !anchorAfter; i--) {
      const ls = p.ids.shots[i]!.lines;
      if (ls.length) {
        const ord = new Map(p.ids.lines.map((l) => [l.id, l.ordinal]));
        anchorAfter = ls.reduce((a, b) => (ord.get(b)! > ord.get(a)! ? b : a));
      }
    }
    if (!anchorAfter) {
      const first = p.ids.lines.find((l) => l.ordinal === 0);
      const later = p.ids.shots.slice(idx + 1).find((s) => s.lines.length);
      if (first && later) input = { ...input, before_line: later.lines[0]! };
    }
  }
  if (anchorAfter) {
    const { el } = lineElement(p, anchorAfter);
    shot ??= ownerAfter(anchorAfter);
    const { end } = paragraphBounds(source, el);
    pos = end;
    insert = `\n\n${text}`;
  } else if (input.before_line) {
    const { el } = lineElement(p, input.before_line);
    shot ??= ownerBefore(input.before_line);
    const { start } = paragraphBounds(source, el);
    pos = start;
    insert = `${text}\n\n`;
  } else if (source.trim()) {
    const trimmed = source.replace(/\s+$/, '');
    const tail = source.slice(trimmed.length);
    // append at the end, keeping the original trailing whitespace after the new paragraph
    const newScript = `${trimmed}\n\n${text}${tail || '\n'}`;
    const res = applyLocalEdit(
      withHash(p),
      newScript,
      trimmed.length,
      source.length,
      newScript.length,
    );
    return attachNew(res, shot);
  } else {
    pos = 0;
    insert = `${text}\n`;
    const res = applyLocalEdit(
      withHash({ ...p, script: source }),
      insert,
      0,
      source.length,
      insert.length,
    );
    return attachNew(res, shot);
  }
  const newScript = source.slice(0, pos) + insert + source.slice(pos);
  const res = applyLocalEdit(withHash(p), newScript, pos, pos, pos + insert.length);
  return attachNew(res, shot);
}

function attachNew(
  res: { project: SbdProject; added: string[]; removed: string[] },
  shot: string | undefined,
): ScriptEditResult {
  let project = res.project;
  if (shot && res.added.length) {
    const ref = project.ids.shots.find((s) => s.id === shot)!;
    project = setShotLines(project, shot, [...ref.lines, ...res.added]);
  }
  return finishScriptEdit(project, res.added, res.removed);
}

/** Replaces the text of one line (one physical line of Fountain). The line keeps its ID. */
export function updateLine(p: SbdProject, lineId: string, text: string): ScriptEditResult {
  if (/[\r\n]/.test(text)) fail('update_line takes a single line; use insert_lines to add lines');
  if (!text.trim()) fail('text is empty; use remove_lines to delete a line');
  const base = withHash(p);
  const { el } = lineElement(base, lineId);
  if (el.startLine !== el.endLine)
    fail(`Line "${lineId}" spans several physical lines and cannot be edited this way`);
  const source = base.script!;
  // Keep the original indentation (dialogue may be indented) and markers the user did not retype.
  const indent = /^\s*/.exec(el.raw)?.[0] ?? '';
  const nextRaw = indent + text.trim();
  const newScript = source.slice(0, el.start) + nextRaw + source.slice(el.end);
  // the changed words only, so character spans on this line move with them
  const cs = textChanges(el.raw, nextRaw).map((c) => ({
    ...c,
    from: c.from + el.start,
    to: c.to + el.start,
  }));
  const first = cs[0] ?? { from: el.start, to: el.start };
  const last = cs.at(-1) ?? first;
  const res = applyLocalEdit(
    base,
    newScript,
    first.from,
    last.to,
    last.to + (nextRaw.length - el.raw.length),
    cs.length ? cs : undefined,
  );
  return finishScriptEdit(res.project, res.added, res.removed);
}

/**
 * Free-form text edit: replaces script source `[from, to)` (UTF-16 offsets) with `insert`, like
 * one change in a text editor. Lines outside the edited range keep their IDs exactly; lines inside
 * it keep their IDs by position when the number of lines did not change (typing within a line),
 * otherwise by similarity. New lines join the shot around them (SPEC §5: between two lines of a
 * shot, or after its last line unless a new scene heading starts). A project without a script
 * gets one.
 */
export function replaceScriptRange(
  p: SbdProject,
  from: number,
  to: number,
  insert: string,
  opts: {
    /**
     * The individual changes (old coordinates, sorted) that `[from, to) → insert` combines, e.g.
     * a burst of typing in two places. Character spans of shots are mapped through them exactly.
     */
    changes?: readonly PosChange[];
  } = {},
): ScriptEditResult {
  const source = p.script ?? '';
  if (!(Number.isInteger(from) && Number.isInteger(to) && 0 <= from && from <= to))
    fail('Invalid range');
  if (to > source.length) fail('Range is past the end of the script');
  const newScript = source.slice(0, from) + insert + source.slice(to);
  if (newScript === p.script) return { project: p, added: [], removed: [], removedCues: [] };
  const base = withHash({ ...p, script: source });
  const res = applyLocalEdit(base, newScript, from, to, from + insert.length, opts.changes);
  let project = res.project;
  if (res.added.length) {
    const doc = scriptDocument(project) ?? undefined;
    // typing: a new line joins the shot above only in the same paragraph (Enter, Enter = new
    // paragraph = outside the shot)
    const placed = remapShots(
      base.ids.lines,
      project.ids.lines,
      res.added,
      project.ids.shots,
      doc,
      {
        paragraph: true,
      },
    );
    project = { ...project, ids: { ...project.ids, shots: placed.shots } };
  }
  return finishScriptEdit(project, res.added, res.removed);
}

/**
 * Deletes lines from the script. Character cues left without dialogue are removed too. Cues
 * targeting deleted lines are removed (returned in `removedCues`).
 */
export function removeLines(p: SbdProject, lineIds: readonly string[]): ScriptEditResult {
  const base = withHash(p);
  const doc = scriptDocument(base) ?? fail('The project has no script');
  const targets = lineIds.map((id) => lineElement(base, id).el);
  const physical = new Set<number>();
  for (const el of targets) for (let i = el.startLine; i <= el.endLine; i++) physical.add(i);
  // character cues whose dialogue block is entirely removed
  doc!.elements.forEach((el, idx) => {
    if (el.type !== 'character') return;
    const block: FountainElement[] = [];
    for (let k = idx + 1; k < doc!.elements.length; k++) {
      const n = doc!.elements[k]!;
      if (n.type !== 'dialogue' && n.type !== 'parenthetical') break;
      block.push(n);
    }
    if (block.length && block.every((b) => physical.has(b.startLine))) physical.add(el.startLine);
  });
  const lines = base.script!.split(/(?<=\n)/);
  const kept: string[] = [];
  lines.forEach((l, i) => {
    if (!physical.has(i)) kept.push(l);
  });
  let newScript = kept.join('').replace(/\n{3,}/g, '\n\n');
  if (base.script!.endsWith('\n') && !newScript.endsWith('\n')) newScript += '\n';
  const r = reanchorLines(base.ids.lines, toNewLines(parseFountain(newScript)));
  const live = new Set(r.entries.map((e) => e.id));
  const shots = base.ids.shots.map((s) => ({ ...s, lines: s.lines.filter((l) => live.has(l)) }));
  const project = withHash({
    ...base,
    script: newScript,
    ids: { ...base.ids, lines: r.entries, shots },
  });
  return finishScriptEdit(
    project,
    r.added,
    r.removed.map((x) => x.id),
  );
}

// ---------------------------------------------------------------------------
// Shot structure (M2 editor): split, merge, duplicate

/**
 * Splits a shot before `atLine` (at character `offset` of that line, format 0.2): the text from
 * there on moves into a new shot inserted right after it. The new shot copies the fields (not the
 * variants or duration).
 */
export function splitShot(
  p: SbdProject,
  shotId: string,
  atLine: string,
  input: { id?: string; title?: string; offset?: number } = {},
): { project: SbdProject; id: string } {
  const old = getShot(p, shotId);
  const ref = p.ids.shots[shotIndex(p, shotId)]!;
  const at = ref.lines.indexOf(atLine);
  if (at < 0) fail(`Line "${atLine}" is not in shot "${shotId}"`);
  const offset = input.offset ?? 0;
  const add: AddShotInput = { after: shotId };
  if (input.id) add.id = input.id;
  if (input.title !== undefined) add.title = input.title;
  if (old.fields && Object.keys(old.fields).length) add.fields = old.fields;
  if (!offset && !hasSpan(ref)) {
    if (at === 0) fail('Pick a line after the first one to split the shot');
    const moved = ref.lines.slice(at);
    const res = addShot(p, add);
    return { project: setShotLines(res.project, res.id, moved), id: res.id };
  }
  const ord = new Map(p.ids.lines.map((l) => [l.id, l.ordinal]));
  const textOf = textLookup(p.ids.lines);
  const b = shotBounds(ref, (id) => ord.get(id), textOf)!;
  const point = {
    ordinal: ord.get(atLine)!,
    offset: Math.min(offset, textOf(atLine)?.length ?? 0),
  };
  if (comparePoints(point, b.start) <= 0 || comparePoints(point, b.end) >= 0)
    fail('Pick a point inside the shot (after its start, before its end) to split it');
  const res = addShot(p, add);
  const byOrd = p.ids.lines.toSorted((x, y) => x.ordinal - y.ordinal);
  const endLine = byOrd[b.end.ordinal]!.id;
  return {
    project: setShotSpan(
      res.project,
      res.id,
      { line: atLine, offset: point.offset },
      { line: endLine, offset: b.end.offset },
    ),
    id: res.id,
  };
}

/**
 * Merges shot `nextId` into `shotId`: lines are combined, variants appended (IDs made unique),
 * empty fields filled from the other shot, cues targeting the merged shot retargeted.
 */
export function mergeShots(p: SbdProject, shotId: string, nextId: string): SbdProject {
  if (shotId === nextId) fail('A shot cannot be merged with itself');
  const a = getShot(p, shotId);
  const b = getShot(p, nextId);
  const refA = p.ids.shots[shotIndex(p, shotId)]!;
  const refB = p.ids.shots[shotIndex(p, nextId)]!;
  const taken = new Set((a.variants ?? []).map((v) => v.id));
  const extra = (b.variants ?? []).map((v) => {
    const id = taken.has(v.id) ? newId('v', taken) : v.id;
    taken.add(id);
    return { ...clone(v), id } as Variant;
  });
  const fields = { ...clone(b.fields ?? {}), ...clone(a.fields ?? {}) };
  for (const [k, v] of Object.entries(a.fields ?? {}))
    if ((v === '' || v === null) && b.fields?.[k] !== undefined) fields[k] = clone(b.fields[k])!;
  const merged: Shot = { ...clone(a), fields, variants: [...(a.variants ?? []), ...extra] };
  if (!merged.active_variant && merged.variants![0]) merged.active_variant = merged.variants![0].id;
  if (a.duration !== undefined && b.duration !== undefined)
    merged.duration = a.duration + b.duration;
  const shots = { ...p.shots, [shotId]: merged };
  delete shots[nextId];
  const ordinal = new Map(p.ids.lines.map((l) => [l.id, l.ordinal]));
  const lines = [...new Set([...refA.lines, ...refB.lines])].sort(
    (x, y) => (ordinal.get(x) ?? 0) - (ordinal.get(y) ?? 0),
  );
  let mergedRef: ShotRef = { ...refA, lines };
  if (hasSpan(refA) || hasSpan(refB)) {
    // the merged shot runs from the earlier start to the later end
    const textOf = textLookup(p.ids.lines);
    const ordOf = (id: string) => ordinal.get(id);
    const ba = shotBounds(refA, ordOf, textOf);
    const bb = shotBounds(refB, ordOf, textOf);
    const { start: _s, end: _e, ...rest } = refA;
    mergedRef = { ...rest, lines };
    const byOrd = p.ids.lines.toSorted((x, y) => x.ordinal - y.ordinal);
    const pts = [ba, bb].filter((x) => x !== null);
    if (pts.length && lines.length) {
      const start = pts.map((x) => x.start).toSorted(comparePoints)[0]!;
      const end = pts
        .map((x) => x.end)
        .toSorted(comparePoints)
        .at(-1)!;
      mergedRef.start = { line: byOrd[start.ordinal]!.id, offset: start.offset };
      mergedRef.end = { line: byOrd[end.ordinal]!.id, offset: end.offset };
      mergedRef = normalizeShotRef(mergedRef, textOf);
    }
  }
  const refs = p.ids.shots
    .filter((r) => r.id !== nextId)
    .map((r) => (r.id === shotId ? mergedRef : r));
  const cues = p.timeline.cues.map((c) =>
    isShotTarget(c.target) && c.target.shot === nextId ? { ...c, target: { shot: shotId } } : c,
  );
  return {
    ...p,
    shots,
    ids: { ...p.ids, shots: refs },
    timeline: { ...p.timeline, cues },
  };
}

/** Copies a shot (fields, variants, duration) right after it. Lines are not copied. */
export function duplicateShot(
  p: SbdProject,
  shotId: string,
  input: { id?: string } = {},
): { project: SbdProject; id: string } {
  const old = getShot(p, shotId);
  const taken = allIds(p);
  const id = input.id ?? newId('s', { has: (x) => taken.has(x) || x in p.shots });
  checkNewId(id, { has: (x) => taken.has(x) || x in p.shots }, 'Shot');
  const copy: Shot = { ...clone(old), id };
  const refs = [...p.ids.shots];
  refs.splice(shotIndex(p, shotId) + 1, 0, { id, lines: [] });
  return {
    project: { ...p, shots: { ...p.shots, [id]: copy }, ids: { ...p.ids, shots: refs } },
    id,
  };
}

/** Moves a variant to a new position (0-based) within its shot. */
export function moveVariant(
  p: SbdProject,
  shotId: string,
  variantId: string,
  index: number,
): SbdProject {
  const old = getShot(p, shotId);
  const variants = [...(old.variants ?? [])];
  const from = variants.findIndex((v) => v.id === variantId);
  if (from < 0) fail(`Shot "${shotId}" has no variant "${variantId}"`);
  const [v] = variants.splice(from, 1);
  variants.splice(Math.max(0, Math.min(index, variants.length)), 0, v!);
  return { ...p, shots: { ...p.shots, [shotId]: { ...old, variants } } };
}

// ---------------------------------------------------------------------------
// Canvas layers (convenience wrappers around updateVariant)

function getCanvas(p: SbdProject, shotId: string, variantId: string): CanvasVariant {
  const v = (getShot(p, shotId).variants ?? []).find((x) => x.id === variantId);
  if (!v) fail(`Shot "${shotId}" has no variant "${variantId}"`);
  if (v!.type !== 'canvas') fail(`Variant "${variantId}" is not a canvas variant`);
  return v as CanvasVariant;
}

export type LayerInput = WithOptionalId<Layer>;

/** Adds a layer on top (or at `index`, 0 = bottom). */
export function addLayer(
  p: SbdProject,
  shotId: string,
  variantId: string,
  input: LayerInput,
  opts: { index?: number } = {},
): { project: SbdProject; id: string } {
  const v = getCanvas(p, shotId, variantId);
  if (!p.assets.assets.some((a) => a.id === input.asset)) fail(`Unknown asset "${input.asset}"`);
  const taken = new Set(v.layers.map((l) => l.id));
  const id = input.id ?? newId('ly', taken);
  checkNewId(id, taken, 'Layer');
  const layers = [...v.layers];
  layers.splice(opts.index ?? layers.length, 0, { ...clone(input), id } as Layer);
  return { project: updateVariant(p, shotId, variantId, { layers }), id };
}

/** Patches one layer; `null` values delete a property (e.g. `crop: null`). */
export function updateLayer(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
  patch: { [K in keyof Layer]?: Layer[K] | null },
): SbdProject {
  const v = getCanvas(p, shotId, variantId);
  if (!v.layers.some((l) => l.id === layerId)) fail(`Unknown layer "${layerId}"`);
  if (patch.id !== undefined && patch.id !== layerId) fail('Layer IDs cannot be changed');
  if (patch.asset && !p.assets.assets.some((a) => a.id === patch.asset))
    fail(`Unknown asset "${String(patch.asset)}"`);
  const layers = v.layers.map((l) => {
    if (l.id !== layerId) return l;
    const next = { ...l, ...clone(patch), id: l.id } as Layer;
    for (const [k, val] of Object.entries(patch)) if (val === null) delete next[k];
    return next;
  });
  return updateVariant(p, shotId, variantId, { layers });
}

export function removeLayer(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
): SbdProject {
  const v = getCanvas(p, shotId, variantId);
  if (!v.layers.some((l) => l.id === layerId)) fail(`Unknown layer "${layerId}"`);
  return updateVariant(p, shotId, variantId, {
    layers: v.layers.filter((l) => l.id !== layerId),
  });
}

/** Moves a layer in the z-order: `index` is the new array position (0 = bottom). */
export function moveLayer(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
  index: number,
): SbdProject {
  const v = getCanvas(p, shotId, variantId);
  const layers = [...v.layers];
  const from = layers.findIndex((l) => l.id === layerId);
  if (from < 0) fail(`Unknown layer "${layerId}"`);
  const [l] = layers.splice(from, 1);
  layers.splice(Math.max(0, Math.min(index, layers.length)), 0, l!);
  return updateVariant(p, shotId, variantId, { layers });
}

export function duplicateLayer(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
  offset = 24,
): { project: SbdProject; id: string } {
  const v = getCanvas(p, shotId, variantId);
  const i = v.layers.findIndex((l) => l.id === layerId);
  if (i < 0) fail(`Unknown layer "${layerId}"`);
  const src = v.layers[i]!;
  const { id: _old, ...rest } = clone(src);
  const input: LayerInput = { ...rest, x: (src.x ?? 0) + offset, y: (src.y ?? 0) + offset };
  if (src.name) input.name = `${src.name} copy`;
  return addLayer(p, shotId, variantId, input, { index: i + 1 });
}

// ---------------------------------------------------------------------------
// Timeline tracks

/** Creates or patches a track definition (`null` deletes a property). */
export function updateTrack(
  p: SbdProject,
  trackId: string,
  patch: { label?: string | null; gain?: number | null; muted?: boolean | null },
): SbdProject {
  if (!isValidId(trackId)) fail(`Invalid track ID "${trackId}"`);
  if (patch.gain !== undefined && patch.gain !== null && !(patch.gain >= 0))
    fail('"gain" must be >= 0');
  const tracks = [...(p.timeline.tracks ?? [])];
  let i = tracks.findIndex((t) => t.id === trackId);
  if (i < 0) {
    tracks.push({ id: trackId });
    i = tracks.length - 1;
  }
  const next: TrackDef = { ...tracks[i]!, ...clone(patch), id: trackId } as TrackDef;
  for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k];
  tracks[i] = next;
  return { ...p, timeline: { ...p.timeline, tracks } };
}
