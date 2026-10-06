/**
 * Project model: load from any file source (folder, zip, HTTP), re-anchor line IDs when the script
 * was edited by hand, serialize back to files.
 */
import { parseFountain, type FountainDocument, type FountainElement } from './fountain.js';
import { hashText } from './hash.js';
import { assignLineIds, reanchorScript, type LineIdEntry } from './reanchor.js';
import { validateProject, type Issue } from './validate.js';
import {
  FORMAT_VERSION,
  type IdsFile,
  type Manifest,
  type SbdProject,
  type Shot,
  type ShotRef,
} from './types.js';
import { manifestFromPreset, type PresetId } from './presets.js';
import { lineSegments, normalizeShotRefs, remapSpansByText, textLookup } from './spans.js';

export const PROJECT_FILES = {
  manifest: 'manifest.json',
  script: 'script.fountain',
  ids: 'ids.json',
  assets: 'assets.json',
  timeline: 'timeline.json',
  shotsDir: 'shots/',
  mediaDir: 'media/',
} as const;

/** Read access to a package (unpacked folder, packed zip, HTTP…). Paths are package-relative. */
export interface SbdReader {
  /** All file paths (POSIX, no directories). */
  list(): Promise<string[]>;
  /** File bytes, or null when missing. */
  read(path: string): Promise<Uint8Array | null>;
}

export class SbdLoadError extends Error {
  override name = 'SbdLoadError';
}

export interface ReanchorSummary {
  /** Lines whose ID was kept (exact, moved or similar). */
  kept: number;
  /** IDs minted for new lines. */
  added: string[];
  /** IDs of lines that disappeared. */
  removed: string[];
  /** New lines that were placed into a shot. */
  placed: Array<{ line: string; shot: string }>;
}

export interface LoadResult {
  project: SbdProject;
  issues: Issue[];
  /** Set when script.fountain changed since ids.json was written. */
  reanchor?: ReanchorSummary;
  /** All files in the package. */
  files: string[];
}

export interface LoadOptions {
  linkedExists?: (src: string) => boolean | undefined;
  /** Skip validation (faster; issues will only contain parse errors). */
  skipValidation?: boolean;
}

const decoder = new TextDecoder();

function parseJson<T>(path: string, bytes: Uint8Array, issues: Issue[]): T | undefined {
  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch (e) {
    issues.push({
      severity: 'error',
      code: 'json',
      message: `${path} is not valid JSON: ${(e as Error).message}`,
      file: path,
    });
    return undefined;
  }
}

/** Loads, re-anchors (if needed) and validates a project. Throws SbdLoadError without a manifest. */
export async function loadProject(reader: SbdReader, opts: LoadOptions = {}): Promise<LoadResult> {
  const files = (await reader.list()).toSorted();
  const has = new Set(files);
  const issues: Issue[] = [];

  const readJson = async <T>(path: string): Promise<T | undefined> => {
    if (!has.has(path)) return undefined;
    const bytes = await reader.read(path);
    return bytes ? parseJson<T>(path, bytes, issues) : undefined;
  };

  const manifest = await readJson<Manifest>(PROJECT_FILES.manifest);
  if (!manifest) {
    throw new SbdLoadError(
      has.has(PROJECT_FILES.manifest)
        ? (issues[0]?.message ?? 'manifest.json is invalid')
        : 'Not a storyboard: manifest.json is missing',
    );
  }
  let script: string | null = null;
  if (has.has(PROJECT_FILES.script)) {
    const bytes = await reader.read(PROJECT_FILES.script);
    if (bytes) script = decoder.decode(bytes);
  }
  const ids = (await readJson<IdsFile>(PROJECT_FILES.ids)) ?? { lines: [], shots: [] };
  const assets = (await readJson<SbdProject['assets']>(PROJECT_FILES.assets)) ?? { assets: [] };
  const timeline = (await readJson<SbdProject['timeline']>(PROJECT_FILES.timeline)) ?? { cues: [] };
  const shots: Record<string, Shot> = {};
  const shotFiles = files.filter((f) => /^shots\/[^/]+\.json$/.test(f));
  for (const f of shotFiles) {
    const shot = await readJson<Shot>(f);
    if (shot) shots[f.slice(6, -5)] = shot;
  }
  // Shots listed in ids.json but without a file get an empty in-memory shot only when the file
  // is missing entirely; validation reports it.
  let project: SbdProject = { manifest, script, ids, shots, assets, timeline };
  if (!Array.isArray(ids.lines)) ids.lines = [];
  if (!Array.isArray(ids.shots)) ids.shots = [];
  if (!Array.isArray(assets.assets)) assets.assets = [];
  if (!Array.isArray(timeline.cues)) timeline.cues = [];

  const synced = syncScript(project);
  project = synced.project;
  if (!opts.skipValidation) {
    const vo: Parameters<typeof validateProject>[1] = { hasFile: (p) => has.has(p) };
    if (opts.linkedExists) vo.linkedExists = opts.linkedExists;
    issues.push(...validateProject(project, vo));
  }
  if (synced.reanchor) {
    const r = synced.reanchor;
    issues.push({
      severity: 'info',
      code: 'reanchored',
      message: `script.fountain was edited outside the tools: kept ${r.kept} line IDs, added ${r.added.length}, removed ${r.removed.length}`,
      file: PROJECT_FILES.ids,
    });
  }
  const result: LoadResult = { project, issues, files };
  if (synced.reanchor) result.reanchor = synced.reanchor;
  return result;
}

/**
 * Brings `ids.lines` in line with the current script. When `ids.script_hash` matches nothing
 * happens. Otherwise lines are re-anchored (IDs kept where possible), shots lose references to
 * deleted lines and new lines are placed into the surrounding shot (see SPEC.md).
 */
export function syncScript(p: SbdProject): { project: SbdProject; reanchor?: ReanchorSummary } {
  if (p.script === null) return { project: p };
  const hash = hashText(p.script);
  if (p.ids.script_hash === hash) return { project: p };
  if (!p.ids.lines.length && !p.ids.script_hash) {
    // First time: assign IDs from scratch, keep shots (none can reference lines yet).
    const lines = assignLineIds(parseFountain(p.script));
    const project = { ...p, ids: { ...p.ids, script_hash: hash, lines } };
    return lines.length
      ? { project, reanchor: { kept: 0, added: lines.map((l) => l.id), removed: [], placed: [] } }
      : { project };
  }
  const result = reanchorScript(p.ids.lines, p.script);
  // character spans follow each line's own text edits
  const textNow = textLookup(result.entries);
  const moved = remapSpansByText(p.ids.shots, textLookup(p.ids.lines), textNow);
  const remapped = remapShots(p.ids.lines, result.entries, result.added, moved, result.doc);
  const shots = normalizeShotRefs(remapped.shots, textNow);
  const placed = remapped.placed;
  return {
    project: { ...p, ids: { ...p.ids, script_hash: hash, lines: result.entries, shots } },
    reanchor: {
      kept: result.matches.length,
      added: result.added,
      removed: result.removed.map((r) => r.id),
      placed,
    },
  };
}

/**
 * Applies a new line mapping to shots: drops removed lines, keeps survivors sorted by script
 * order and places added lines that fall inside or at the end of a shot. A shot "owns" the end of
 * a line when it covers that line up to its last character (and the start when it covers it from
 * the first), so a shot whose span ends mid-line never grabs the next line. With
 * `paragraph: true` (typing in an editor) a new line joins the shot above only when no blank
 * line separates them.
 */
export function remapShots(
  _oldEntries: readonly LineIdEntry[],
  entries: readonly LineIdEntry[],
  added: readonly string[],
  shotRefs: readonly ShotRef[],
  doc?: FountainDocument,
  opts: { paragraph?: boolean } = {},
): { shots: ShotRef[]; placed: Array<{ line: string; shot: string }> } {
  const ordinal = new Map(entries.map((e) => [e.id, e.ordinal]));
  const addedSet = new Set(added);
  const textOf = textLookup(entries);
  const shots = shotRefs.map((s) => ({ ...s, lines: s.lines.filter((id) => ordinal.has(id)) }));
  const endOwner = new Map<string, string>();
  const startOwner = new Map<string, string>();
  for (const [line, segs] of lineSegments(shots, textOf)) {
    const len = textOf(line)?.length ?? 0;
    const last = segs.findLast((x) => x.to >= len);
    const first = segs.find((x) => x.from <= 0);
    if (last) endOwner.set(line, last.shot);
    if (first) startOwner.set(line, first.shot);
  }
  const sameParagraph = (a: number, b: number): boolean => {
    if (!opts.paragraph || !doc) return true;
    const x = doc.lines[a];
    const y = doc.lines[b];
    if (!x || !y) return true;
    return !/\n[ \t]*\r?\n/.test(doc.source.slice(x.end, y.start));
  };
  const placed: Array<{ line: string; shot: string }> = [];
  const byId = new Map(shots.map((s) => [s.id, s]));
  const order = new Map(shots.map((s, i) => [s.id, i]));
  let sceneSinceAnchor = false;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (!addedSet.has(e.id)) {
      sceneSinceAnchor = false;
      continue;
    }
    if (e.type === 'scene_heading' || doc?.lines[i]?.type === 'scene_heading')
      sceneSinceAnchor = true;
    // nearest previous / next existing (non-added) lines
    let prev: string | undefined;
    let prevExists = false;
    let prevAt = -1;
    for (let j = i - 1; j >= 0; j--) {
      const id = entries[j]!.id;
      if (!addedSet.has(id)) {
        prev = endOwner.get(id);
        prevExists = true;
        prevAt = j;
        break;
      }
    }
    // the line right above (new or not), for the paragraph rule
    const above = i - 1;
    let next: string | undefined;
    for (let j = i + 1; j < entries.length; j++) {
      const id = entries[j]!.id;
      if (!addedSet.has(id)) {
        next = startOwner.get(id);
        break;
      }
    }
    let target: string | undefined;
    if (prev && prev === next) target = prev;
    else if (
      prev &&
      !sceneSinceAnchor &&
      (!next || order.get(next)! > order.get(prev)!) &&
      above >= 0 &&
      (above === prevAt || endOwner.get(entries[above]!.id) === prev) &&
      sameParagraph(above, i)
    )
      target = prev;
    else if (!prevExists && next && !sceneSinceAnchor) target = next;
    if (target) {
      const own = byId.get(target)!.lines;
      if (!own.includes(e.id)) own.push(e.id);
      endOwner.set(e.id, target);
      startOwner.set(e.id, target);
      placed.push({ line: e.id, shot: target });
    }
  }
  for (const s of shots) s.lines.sort((a, b) => ordinal.get(a)! - ordinal.get(b)!);
  return { shots, placed };
}

// ---------------------------------------------------------------------------
// Serialization

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * All text files of the project (path → contents), with `ids.script_hash` updated. Media files
 * are not included. Shot files are written for every shot in `p.shots`.
 */
export function serializeProject(p: SbdProject): Record<string, string> {
  const ids: IdsFile = {
    ...p.ids,
    script_hash: p.script === null ? null : hashText(p.script),
  };
  // Keep script_hash first for readability.
  const { script_hash, lines, shots, ...rest } = ids;
  const out: Record<string, string> = {
    [PROJECT_FILES.manifest]: json(p.manifest),
    [PROJECT_FILES.ids]: json({ script_hash, ...rest, shots, lines }),
    [PROJECT_FILES.assets]: json(p.assets),
    [PROJECT_FILES.timeline]: json(p.timeline),
  };
  if (p.script !== null) out[PROJECT_FILES.script] = p.script;
  const order = p.ids.shots.map((s) => s.id);
  const all = [...order, ...Object.keys(p.shots).filter((id) => !order.includes(id))];
  for (const id of all) {
    const shot = p.shots[id];
    if (shot) out[`${PROJECT_FILES.shotsDir}${id}.json`] = json(shot);
  }
  return out;
}

/** Text files encoded as bytes (an SbdTree without media). */
export function projectTree(p: SbdProject): Record<string, Uint8Array> {
  const enc = new TextEncoder();
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(serializeProject(p))) out[k] = enc.encode(v);
  return out;
}

/** Reader over an in-memory tree (e.g. the result of `unpackSbd`). */
export function treeReader(tree: Record<string, Uint8Array>): SbdReader {
  return {
    list: async () => Object.keys(tree),
    read: async (path) => tree[path] ?? null,
  };
}

export interface NewProjectOptions {
  title: string;
  preset?: PresetId;
  aspect_ratio?: string;
  script?: string | null;
  now?: Date;
}

/** A new, empty (valid) project. */
export function createProject(opts: NewProjectOptions): SbdProject {
  const mo: Parameters<typeof manifestFromPreset>[0] = { title: opts.title };
  if (opts.preset) mo.preset = opts.preset;
  if (opts.aspect_ratio) mo.aspect_ratio = opts.aspect_ratio;
  if (opts.now) mo.now = opts.now;
  const manifest = manifestFromPreset(mo);
  manifest.generator = `storyboard-viewer ${FORMAT_VERSION}`;
  const script = opts.script ?? null;
  const p: SbdProject = {
    manifest,
    script,
    ids: { script_hash: null, lines: [], shots: [] },
    shots: {},
    assets: { assets: [] },
    timeline: { tracks: [], cues: [] },
  };
  return syncScript(p).project;
}

// ---------------------------------------------------------------------------
// Derived views

let docCache: { script: string; doc: FountainDocument } | undefined;

/** Parsed script (memoized for the last script string). */
export function scriptDocument(p: Pick<SbdProject, 'script'>): FountainDocument | null {
  if (p.script === null) return null;
  if (docCache?.script !== p.script) docCache = { script: p.script, doc: parseFountain(p.script) };
  return docCache.doc;
}

export interface ResolvedLine {
  id: string;
  ordinal: number;
  /** Parsed element (type, character, extension, text…); undefined when ids.json is out of sync. */
  element?: FountainElement;
  text: string;
  type?: string;
}

/** Line ID → line (text from the parsed script, falling back to ids.json). */
export function resolveLines(p: SbdProject): Map<string, ResolvedLine> {
  const doc = scriptDocument(p);
  const out = new Map<string, ResolvedLine>();
  for (const e of p.ids.lines) {
    const el = doc?.lines[e.ordinal];
    const line: ResolvedLine = { id: e.id, ordinal: e.ordinal, text: el?.text ?? e.text };
    if (el) line.element = el;
    const type = el?.type ?? e.type;
    if (type) line.type = type;
    out.set(e.id, line);
  }
  return out;
}

/** Shots in story order with their files. */
export function orderedShots(p: SbdProject): Array<{ ref: ShotRef; shot: Shot; index: number }> {
  return p.ids.shots.map((ref, index) => ({
    ref,
    shot: p.shots[ref.id] ?? { id: ref.id },
    index,
  }));
}

/** IDs of script lines that belong to no shot, in script order. */
export function unassignedLines(p: SbdProject): string[] {
  const used = new Set(p.ids.shots.flatMap((s) => s.lines));
  return p.ids.lines.filter((l) => !used.has(l.id)).map((l) => l.id);
}

/** The variant shown for a shot (active or first). */
export function activeVariant(shot: Shot) {
  const vs = shot.variants ?? [];
  return vs.find((v) => v.id === shot.active_variant) ?? vs[0];
}
