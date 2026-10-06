/**
 * Line-ID re-anchoring: keep stable IDs for script lines when `script.fountain` is edited
 * outside the tools.
 *
 * Passes (each only considers lines not matched by an earlier pass):
 *  1. **exact** – Myers diff (LCS) over normalized line text. In-order unchanged lines keep IDs.
 *  2. **moved** – identical text found elsewhere (reordered lines); nearest relative position wins.
 *  3. **similar (local)** – inside each gap between two exact anchors, pairs with
 *     similarity ≥ `localThreshold` are matched greedily (best score first).
 *  4. **similar (global)** – remaining lines anywhere with similarity ≥ `globalThreshold`
 *     (edited *and* moved). Skipped when the candidate matrix is huge.
 *  5. Everything else gets a fresh ID; unmatched old entries are reported as removed.
 *
 * Similarity = max(normalized Levenshtein, word-multiset Dice) on lower-cased normalized text,
 * minus a small penalty when both lines carry a different element type.
 */
import { hashLine, normalizeLine } from './hash.js';
import { parseFountain, type FountainDocument } from './fountain.js';

/** One entry of `ids.json` `lines`. */
export interface LineIdEntry {
  id: string;
  ordinal: number;
  hash: string;
  text: string;
  type?: string;
}

export interface NewLine {
  text: string;
  type?: string;
}

export type MatchKind = 'exact' | 'moved' | 'similar';

export interface LineMatch {
  id: string;
  oldOrdinal: number;
  newOrdinal: number;
  kind: MatchKind;
  /** 1 for exact/moved, similarity otherwise. */
  score: number;
}

export interface ReanchorResult {
  /** New mapping ordered by ordinal (`entries[i].ordinal === i`). */
  entries: LineIdEntry[];
  matches: LineMatch[];
  /** IDs minted for lines with no match. */
  added: string[];
  /** Old entries that no longer exist. */
  removed: LineIdEntry[];
}

export interface ReanchorOptions {
  /** ID generator; must return an ID not in `taken`. Defaults to `l_` + 8 random base36 chars. */
  newId?: (taken: ReadonlySet<string>) => string;
  /** Similarity threshold inside a gap between exact anchors. Default 0.5. */
  localThreshold?: number;
  /** Similarity threshold for the global pass. Default 0.7. */
  globalThreshold?: number;
  /** Max old×new candidate pairs for the global pass. Default 1_000_000. */
  maxGlobalPairs?: number;
  /** Max edit distance (in lines) for the Myers pass before falling back. Default 2000. */
  maxDiff?: number;
}

const TYPE_MISMATCH_PENALTY = 0.15;

export function randomLineId(taken: ReadonlySet<string>): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  for (;;) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    let id = 'l_';
    for (const b of bytes) id += alphabet[b % 36];
    if (!taken.has(id)) return id;
  }
}

// ---------------------------------------------------------------------------
// Similarity

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length > b.length) [a, b] = [b, a];
  let prev = new Uint32Array(a.length + 1);
  let cur = new Uint32Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    cur[0] = j;
    const bc = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bc ? 0 : 1;
      cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[a.length]!;
}

function words(s: string): string[] {
  return s.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
}

function dice(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) {
    const c = counts.get(w);
    if (c) {
      common++;
      counts.set(w, c - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

interface Prepared {
  key: string;
  lower: string;
  words: string[];
  type: string | undefined;
}

function prepare(text: string, type: string | undefined): Prepared {
  const key = normalizeLine(text);
  const lower = key.toLowerCase();
  return { key, lower, words: words(lower), type };
}

/** Similarity in [0, 1]. Returns -1 quickly when it cannot reach `min`. */
function similarity(a: Prepared, b: Prepared, min: number): number {
  const penalty = a.type && b.type && a.type !== b.type ? TYPE_MISMATCH_PENALTY : 0;
  const la = a.lower.length;
  const lb = b.lower.length;
  const maxLen = Math.max(la, lb);
  if (maxLen === 0) return 1 - penalty;
  const d = dice(a.words, b.words);
  // Levenshtein similarity is bounded by minLen/maxLen; skip the O(n·m) work if hopeless.
  let lev = 0;
  if (Math.min(la, lb) / maxLen - penalty >= min && d - penalty < 1) {
    lev = 1 - levenshtein(a.lower, b.lower) / maxLen;
  }
  const s = Math.max(lev, d) - penalty;
  return s >= min ? s : -1;
}

// ---------------------------------------------------------------------------
// Myers diff → matched index pairs (old, new), or null if the diff exceeds maxD.

function myersPairs(a: number[], b: number[], maxD: number): Array<[number, number]> | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  outer: for (let d = 0; d <= max; d++) {
    if (d > maxD) return null;
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!)) x = v[off + k + 1]!;
      else x = v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice(off - d, off + d + 1));
        found = d;
        break outer;
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  const pairs: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]!;
    const get = (k: number) => prev[k + d - 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    pairs.push([x, y]);
  }
  return pairs.toReversed();
}

/** LCS pairs over integer keys with common prefix/suffix trimmed first. */
function lcsPairs(a: number[], b: number[], maxD: number): Array<[number, number]> {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  const mid = myersPairs(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf), maxD);
  // Fallback for huge rewrites: no middle anchors; later passes still match moved/similar lines.
  for (const [i, j] of mid ?? []) pairs.push([i + pre, j + pre]);
  for (let s = suf; s > 0; s--) pairs.push([a.length - s, b.length - s]);
  return pairs;
}

// ---------------------------------------------------------------------------

function greedyMatch(
  olds: number[],
  news: number[],
  oldP: Prepared[],
  newP: Prepared[],
  threshold: number,
  oldLen: number,
  newLen: number,
): Array<[number, number, number]> {
  const cands: Array<[number, number, number, number]> = [];
  for (const i of olds) {
    for (const j of news) {
      const s = similarity(oldP[i]!, newP[j]!, threshold);
      if (s >= threshold) {
        const dist = Math.abs(i / Math.max(1, oldLen) - j / Math.max(1, newLen));
        cands.push([i, j, s, dist]);
      }
    }
  }
  cands.sort((p, q) => q[2] - p[2] || p[3] - q[3] || p[1] - q[1]);
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const out: Array<[number, number, number]> = [];
  for (const [i, j, s] of cands) {
    if (usedOld.has(i) || usedNew.has(j)) continue;
    usedOld.add(i);
    usedNew.add(j);
    out.push([i, j, s]);
  }
  return out;
}

export function reanchorLines(
  oldEntries: readonly LineIdEntry[],
  newLines: readonly NewLine[],
  options: ReanchorOptions = {},
): ReanchorResult {
  const {
    newId = randomLineId,
    localThreshold = 0.5,
    globalThreshold = 0.7,
    maxGlobalPairs = 1_000_000,
    maxDiff = 2000,
  } = options;

  const old = oldEntries.toSorted((p, q) => p.ordinal - q.ordinal);
  const oldP = old.map((e) => prepare(e.text, e.type));
  const newP = newLines.map((l) => prepare(l.text, l.type));
  const oldLen = old.length;
  const newLen = newLines.length;

  const keyIds = new Map<string, number>();
  const keyOf = (p: Prepared) => {
    let k = keyIds.get(p.key);
    if (k === undefined) keyIds.set(p.key, (k = keyIds.size));
    return k;
  };
  const oldKeys = oldP.map(keyOf);
  const newKeys = newP.map(keyOf);

  const oldToNew = new Int32Array(oldLen).fill(-1);
  const newToOld = new Int32Array(newLen).fill(-1);
  const kindOf: MatchKind[] = [];
  const scoreOf = new Float64Array(newLen);
  const link = (i: number, j: number, kind: MatchKind, score: number) => {
    oldToNew[i] = j;
    newToOld[j] = i;
    kindOf[j] = kind;
    scoreOf[j] = score;
  };

  // 1. exact, in order
  const anchors = lcsPairs(oldKeys, newKeys, maxDiff);
  for (const [i, j] of anchors) link(i, j, 'exact', 1);

  // 2. moved: same text elsewhere
  const byKey = new Map<number, number[]>();
  for (let i = 0; i < oldLen; i++) {
    if (oldToNew[i] !== -1) continue;
    const list = byKey.get(oldKeys[i]!);
    if (list) list.push(i);
    else byKey.set(oldKeys[i]!, [i]);
  }
  for (let j = 0; j < newLen; j++) {
    if (newToOld[j] !== -1) continue;
    const list = byKey.get(newKeys[j]!);
    if (!list?.length) continue;
    let best = 0;
    let bestDist = Infinity;
    list.forEach((i, idx) => {
      const dist = Math.abs(i / oldLen - j / newLen);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    });
    const [i] = list.splice(best, 1);
    link(i!, j, 'moved', 1);
  }

  // 3. similar within gaps between exact anchors
  const bounds: Array<[number, number]> = [[-1, -1], ...anchors, [oldLen, newLen]];
  for (let g = 0; g + 1 < bounds.length; g++) {
    const [oa, na] = bounds[g]!;
    const [ob, nb] = bounds[g + 1]!;
    const olds: number[] = [];
    const news: number[] = [];
    for (let i = oa + 1; i < ob; i++) if (oldToNew[i] === -1) olds.push(i);
    for (let j = na + 1; j < nb; j++) if (newToOld[j] === -1) news.push(j);
    if (!olds.length || !news.length) continue;
    for (const [i, j, s] of greedyMatch(olds, news, oldP, newP, localThreshold, oldLen, newLen)) {
      link(i, j, 'similar', s);
    }
  }

  // 4. similar anywhere (edited and moved)
  const restOld: number[] = [];
  const restNew: number[] = [];
  for (let i = 0; i < oldLen; i++) if (oldToNew[i] === -1) restOld.push(i);
  for (let j = 0; j < newLen; j++) if (newToOld[j] === -1) restNew.push(j);
  if (restOld.length && restNew.length && restOld.length * restNew.length <= maxGlobalPairs) {
    for (const [i, j, s] of greedyMatch(
      restOld,
      restNew,
      oldP,
      newP,
      globalThreshold,
      oldLen,
      newLen,
    )) {
      link(i, j, 'similar', s);
    }
  }

  // 5. assemble
  const taken = new Set<string>(old.map((e) => e.id));
  const entries: LineIdEntry[] = [];
  const matches: LineMatch[] = [];
  const added: string[] = [];
  for (let j = 0; j < newLen; j++) {
    const line = newLines[j]!;
    const i = newToOld[j]!;
    let id: string;
    if (i === -1) {
      id = newId(taken);
      if (taken.has(id)) throw new Error(`newId returned a duplicate id: ${id}`);
      taken.add(id);
      added.push(id);
    } else {
      id = old[i]!.id;
      matches.push({
        id,
        oldOrdinal: old[i]!.ordinal,
        newOrdinal: j,
        kind: kindOf[j]!,
        score: scoreOf[j]!,
      });
    }
    const entry: LineIdEntry = { id, ordinal: j, hash: hashLine(line.text), text: line.text };
    if (line.type !== undefined) entry.type = line.type;
    entries.push(entry);
  }
  const removed = old.filter((_, i) => oldToNew[i] === -1);
  return { entries, matches, added, removed };
}

/** Builds a fresh `ids.json`-style mapping for a parsed script. */
export function assignLineIds(
  doc: FountainDocument,
  newId: (taken: ReadonlySet<string>) => string = randomLineId,
): LineIdEntry[] {
  return reanchorLines([], toNewLines(doc), { newId }).entries;
}

export function toNewLines(doc: FountainDocument): NewLine[] {
  return doc.lines.map((el) => ({ text: el.text, type: el.type }));
}

/** Parses `newSource` and re-anchors `oldEntries` onto it. */
export function reanchorScript(
  oldEntries: readonly LineIdEntry[],
  newSource: string,
  options?: ReanchorOptions,
): ReanchorResult & { doc: FountainDocument } {
  const doc = parseFountain(newSource);
  return { ...reanchorLines(oldEntries, toNewLines(doc), options), doc };
}

/**
 * Updates a shot's line references after re-anchoring: IDs that survived are kept (in the
 * shot's original order), IDs of removed lines are dropped.
 */
export function remapLineRefs(lineIds: readonly string[], result: ReanchorResult): string[] {
  const live = new Set(result.entries.map((e) => e.id));
  return lineIds.filter((id) => live.has(id));
}

/**
 * Longest-common-subsequence pairs `[i, j]` (in order) between two sequences of strings, e.g. the
 * physical lines of two versions of a script. Used for three-way merges and for applying a remote
 * change to an open editor as small edits (so the cursor stays put).
 */
export function diffLines(
  a: readonly string[],
  b: readonly string[],
  maxDiff = 4000,
): Array<[number, number]> {
  const keys = new Map<string, number>();
  const key = (s: string) => {
    let k = keys.get(s);
    if (k === undefined) keys.set(s, (k = keys.size));
    return k;
  };
  return lcsPairs(a.map(key), b.map(key), maxDiff);
}
