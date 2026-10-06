/**
 * Line-oriented Fountain parser that records source positions for every element.
 *
 * Why in-house: `fountain-js` (and the other parsers we looked at) splits the
 * script on blank lines, strips boneyard before tokenizing and emits tokens without
 * any source positions, so there is no reliable way to map a token back to its line.
 * Storyboard Viewer needs per-line positions to assign stable line IDs, so this parser
 * works on physical lines and keeps `startLine/endLine/start/end` for every element.
 *
 * Granularity: one element per non-blank physical line (multi-line notes, boneyard and
 * title-page values span several lines). An action paragraph of three lines is three
 * `action` elements; a dialogue block is one `character` element followed by one
 * `parenthetical`/`dialogue` element per line.
 *
 * Reference: https://fountain.io/syntax (Fountain 1.1).
 */

export type FountainElementType =
  | 'title_page'
  | 'scene_heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'centered'
  | 'lyrics'
  | 'section'
  | 'synopsis'
  | 'note'
  | 'boneyard'
  | 'page_break';

export interface FountainElement {
  type: FountainElementType;
  /**
   * Display text: markers (`.`, `!`, `>`, `~`, `@`, `#`, `^`, scene numbers) removed, inline
   * notes and boneyard removed, trimmed. Emphasis markers (`*`, `_`) are kept.
   */
  text: string;
  /** Exact source slice from `start` to `end`. */
  raw: string;
  /** 0-based index of the first physical line. */
  startLine: number;
  /** 0-based index of the last physical line (inclusive). */
  endLine: number;
  /** UTF-16 offset of the first character in the source. */
  start: number;
  /** UTF-16 offset one past the last character (newline excluded). */
  end: number;
  /** Index among anchorable elements (see {@link ANCHORABLE_TYPES}); undefined otherwise. */
  ordinal?: number;
  /** Scene number from `#12A#` on a scene heading. */
  sceneNumber?: string;
  /** Section depth (number of `#`). */
  depth?: number;
  /** Character name for `character`, `parenthetical` and `dialogue` elements. */
  character?: string;
  /** Character extension, e.g. `V.O.`, `O.S.`, `CONT'D`. */
  extension?: string;
  /** Dual dialogue (`^` after the character name). */
  dual?: boolean;
  /** Title page key (`title_page` elements). */
  key?: string;
  /** Inline `[[notes]]` that were removed from `text`. */
  notes?: string[];
  /**
   * Single-line elements: source offset of the first character of `text` (after markers and
   * indentation). Used to map character offsets within `text` to source positions.
   */
  textStart?: number;
  /**
   * Only when `text` is interrupted by an inline note or boneyard: the source offset of every
   * character of `text`, plus one entry for the end (`textMap.length === text.length + 1`).
   */
  textMap?: number[];
}

export interface FountainDocument {
  source: string;
  /** All elements in source order. */
  elements: FountainElement[];
  /** Anchorable elements in order; `lines[i].ordinal === i`. */
  lines: FountainElement[];
  /** Title page key/value pairs (keys lower-cased). */
  titlePage: Record<string, string>;
}

/**
 * Element types that get stable line IDs. Character cues are excluded on purpose: the
 * cue is metadata of the dialogue below it (available as `element.character`), so
 * renaming a character does not churn line IDs.
 */
export const ANCHORABLE_TYPES: ReadonlySet<FountainElementType> = new Set<FountainElementType>([
  'scene_heading',
  'action',
  'parenthetical',
  'dialogue',
  'transition',
  'centered',
  'lyrics',
]);

const TITLE_KEYS = new Set([
  'title',
  'credit',
  'author',
  'authors',
  'source',
  'draft date',
  'date',
  'contact',
  'copyright',
  'notes',
  'revision',
]);

const SCENE_RE = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;
const SCENE_NUMBER_RE = /\s*#([\w.-]+)#\s*$/;
const TITLE_KEY_RE = /^([A-Za-z][A-Za-z0-9 _-]*):(.*)$/;
const PAGE_BREAK_RE = /^\s*={3,}\s*$/;
const SECTION_RE = /^\s*(#+)\s*(.*)$/;
const SYNOPSIS_RE = /^\s*=(?!=)\s*(.*)$/;
const CENTERED_RE = /^\s*>\s*(.*?)\s*<\s*$/;
const FORCED_TRANSITION_RE = /^\s*>\s*(.*)$/;
const PARENTHETICAL_RE = /^\s*\(.*\)\s*$/;

interface MaskRange {
  kind: 'boneyard' | 'note';
  start: number;
  /** exclusive, includes the closing marker */
  end: number;
  /** inner text (notes only) */
  inner: string;
}

interface PhysLine {
  index: number;
  start: number;
  end: number;
  raw: string;
  /** raw minus boneyard/note characters */
  visible: string;
  /** notes whose `[[` starts on this line */
  notes: string[];
  kind: 'blank' | 'transparent' | 'content';
  /** Pieces of `visible`: visible index `v` starts at source offset `s` for `len` characters. */
  segs: Array<{ v: number; s: number; len: number }>;
}

function splitLines(source: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c === 10 /* \n */ || c === 13 /* \r */) {
      out.push({ start, end: i });
      if (c === 13 && source.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  out.push({ start, end: source.length });
  return out;
}

/** Finds boneyard (`/* *\/`) and note (`[[ ]]`) ranges. Boneyard wins over notes. */
function findMasks(source: string): MaskRange[] {
  const masks: MaskRange[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      masks.push({ kind: 'boneyard', start: i, end, inner: '' });
      i = end;
      continue;
    }
    if (source.startsWith('[[', i)) {
      const close = source.indexOf(']]', i + 2);
      if (close !== -1) {
        const inner = source.slice(i + 2, close);
        // A note may span lines but not a truly empty line (spec: use two spaces).
        if (!/(?:\r\n|\r|\n) ?(?:\r\n|\r|\n)/.test(inner)) {
          masks.push({ kind: 'note', start: i, end: close + 2, inner: inner.trim() });
          i = close + 2;
          continue;
        }
      }
    }
    i++;
  }
  return masks;
}

function buildLines(source: string, masks: MaskRange[]): PhysLine[] {
  const spans = splitLines(source);
  const lines: PhysLine[] = [];
  let m = 0;
  for (let index = 0; index < spans.length; index++) {
    const { start, end } = spans[index]!;
    const raw = source.slice(start, end);
    while (m < masks.length && masks[m]!.end <= start) m++;
    let visible = '';
    const notes: string[] = [];
    const segs: PhysLine['segs'] = [];
    let masked = false;
    let pos = start;
    for (let k = m; k < masks.length && masks[k]!.start < end; k++) {
      const mask = masks[k]!;
      if (mask.start > pos) {
        segs.push({ v: visible.length, s: pos, len: mask.start - pos });
        visible += source.slice(pos, mask.start);
      }
      if (mask.kind === 'note' && mask.start >= start) notes.push(mask.inner);
      masked = true;
      pos = Math.max(pos, Math.min(mask.end, end));
    }
    if (pos < end) {
      segs.push({ v: visible.length, s: pos, len: end - pos });
      visible += source.slice(pos, end);
    }
    let kind: PhysLine['kind'];
    if (visible.trim() !== '') kind = 'content';
    else if (masked) kind = 'transparent';
    else kind = 'blank';
    lines.push({ index, start, end, raw, visible, notes, kind, segs });
  }
  return lines;
}

function isUpper(s: string): boolean {
  return /\p{L}/u.test(s) && s === s.toUpperCase();
}

interface CharacterCue {
  name: string;
  extension?: string;
  dual: boolean;
}

function parseCharacterCue(visible: string): CharacterCue | null {
  let s = visible.trim();
  let dual = false;
  if (s.endsWith('^')) {
    dual = true;
    s = s.slice(0, -1).trimEnd();
  }
  const forced = s.startsWith('@');
  if (forced) s = s.slice(1).trimStart();
  const m = /^(.*?)\s*(?:\(([^)]*)\))?\s*$/.exec(s);
  const name = (m?.[1] ?? s).trim();
  const extension = m?.[2]?.trim();
  if (!name) return null;
  if (!forced && (!isUpper(name) || !/^[\p{Lu}\p{N}]/u.test(name))) return null;
  return { name, ...(extension ? { extension } : {}), dual };
}

/** Removes Fountain emphasis markers (`*`, `**`, `***`, `_`) but keeps escaped characters. */
export function stripEmphasis(text: string): string {
  const escapes = ['*', '_', '\\'];
  return text
    .replace(/\\([*_\\])/g, (_, c: string) => String.fromCharCode(0xe000 + escapes.indexOf(c)))
    .replace(/[*_]/g, '')
    .replace(/[\uE000-\uE002]/g, (c) => escapes[c.charCodeAt(0) - 0xe000]!);
}

/** Records where an element's `text` sits in the source (see `textStart` / `textMap`). */
function locateText(el: FountainElement, line: PhysLine, skip: number): void {
  const text = el.text;
  let at = line.visible.indexOf(text, Math.min(skip, line.visible.length));
  if (at < 0) at = line.visible.indexOf(text);
  if (at < 0) return;
  const src = (vi: number): number => {
    for (const g of line.segs) if (vi >= g.v && vi < g.v + g.len) return g.s + (vi - g.v);
    const last = line.segs.at(-1);
    return last ? last.s + last.len : line.end;
  };
  el.textStart = src(at);
  const end = at + text.length;
  // contiguous in the source unless a note or boneyard sits inside the text
  const seg = line.segs.find((g) => at >= g.v && at < g.v + g.len);
  if (!text.length || (seg && end <= seg.v + seg.len)) return;
  const map: number[] = [];
  for (let i = at; i < end; i++) map.push(src(i));
  map.push(src(end - 1) + 1);
  el.textMap = map;
}

/**
 * Source offset of character `offset` of a single-line element's `text` (`offset` is clamped to
 * `0…text.length`; `text.length` maps to just after the last character).
 */
export function textOffsetToSource(el: FountainElement, offset: number): number {
  const o = Math.max(0, Math.min(el.text.length, Math.round(offset)));
  if (el.textMap) return el.textMap[o]!;
  return (el.textStart ?? el.start) + o;
}

/** Character offset within `el.text` closest to source position `pos` (clamped). */
export function sourceToTextOffset(el: FountainElement, pos: number): number {
  const n = el.text.length;
  if (el.textMap) {
    let o = 0;
    while (o < n && el.textMap[o + 1]! <= pos) o++;
    return o;
  }
  return Math.max(0, Math.min(n, pos - (el.textStart ?? el.start)));
}

export function parseFountain(source: string): FountainDocument {
  const masks = findMasks(source);
  const lines = buildLines(source, masks);
  const elements: FountainElement[] = [];
  const titlePage: Record<string, string> = {};

  const lineEl = (
    line: PhysLine,
    type: FountainElementType,
    text: string,
    extra: Partial<FountainElement> = {},
    /** Visible characters before the text (markers, indentation): where to look for it. */
    skip = 0,
  ): FountainElement => {
    const el: FountainElement = {
      type,
      text: text.trim(),
      raw: line.raw,
      startLine: line.index,
      endLine: line.index,
      start: line.start,
      end: line.end,
      ...extra,
    };
    if (line.notes.length) el.notes = [...line.notes];
    locateText(el, line, skip);
    return el;
  };

  // Boneyard elements and stand-alone notes (notes starting on a line with no content).
  const lineAt = (offset: number): PhysLine => {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid]!.start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lines[lo]!;
  };
  for (const mask of masks) {
    const first = lineAt(mask.start);
    if (mask.kind === 'note' && first.kind === 'content') continue;
    const last = lineAt(Math.max(mask.start, mask.end - 1));
    elements.push({
      type: mask.kind,
      text: mask.kind === 'note' ? mask.inner : '',
      raw: source.slice(mask.start, mask.end),
      startLine: first.index,
      endLine: last.index,
      start: mask.start,
      end: mask.end,
    });
  }
  if (masks.length) {
    // Notes on transparent lines were handled above; avoid duplicating them on elements.
    for (const line of lines) if (line.kind !== 'content') line.notes = [];
  }

  // Title page: must start on the first line with a known key.
  let i = 0;
  const firstKey = lines[0] && TITLE_KEY_RE.exec(lines[0].visible);
  if (firstKey && TITLE_KEYS.has(firstKey[1]!.trim().toLowerCase())) {
    let current: { el: FountainElement; parts: string[] } | null = null;
    const flush = () => {
      if (!current) return;
      current.el.text = current.parts.filter(Boolean).join('\n');
      current.el.raw = source.slice(current.el.start, current.el.end);
      titlePage[current.el.key!] = current.el.text;
      elements.push(current.el);
      current = null;
    };
    for (; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.kind === 'blank') break;
      if (line.kind === 'transparent') continue;
      const kv = /^\s/.test(line.visible) ? null : TITLE_KEY_RE.exec(line.visible);
      if (kv) {
        flush();
        current = {
          el: lineEl(line, 'title_page', '', { key: kv[1]!.trim().toLowerCase() }),
          parts: [kv[2]!.trim()],
        };
      } else if (current) {
        current.parts.push(line.visible.trim());
        current.el.endLine = line.index;
        current.el.end = line.end;
      }
    }
    flush();
  }

  // Context helpers over non-transparent lines.
  const prevKind = (idx: number): PhysLine['kind'] => {
    for (let k = idx - 1; k >= 0; k--) if (lines[k]!.kind !== 'transparent') return lines[k]!.kind;
    return 'blank';
  };
  const nextKind = (idx: number): PhysLine['kind'] => {
    for (let k = idx + 1; k < lines.length; k++)
      if (lines[k]!.kind !== 'transparent') return lines[k]!.kind;
    return 'blank';
  };

  let dialogue: CharacterCue | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.kind === 'transparent') continue;
    if (line.kind === 'blank') {
      // Two or more spaces keep a dialogue block open (spec: intentional blank line).
      if (dialogue && /^ {2,}$/.test(line.raw)) continue;
      dialogue = null;
      continue;
    }
    const v = line.visible;
    const t = v.trim();

    const lead = v.length - v.trimStart().length;
    if (dialogue) {
      const speaker = {
        character: dialogue.name,
        ...(dialogue.extension ? { extension: dialogue.extension } : {}),
      };
      if (PARENTHETICAL_RE.test(v)) elements.push(lineEl(line, 'parenthetical', t, speaker, lead));
      else elements.push(lineEl(line, 'dialogue', t, speaker, lead));
      continue;
    }

    const prevBlank = prevKind(i) === 'blank';
    const nextBlank = nextKind(i) === 'blank';
    let m: RegExpExecArray | null;

    if (PAGE_BREAK_RE.test(v)) {
      elements.push(lineEl(line, 'page_break', ''));
    } else if ((m = SECTION_RE.exec(v))) {
      elements.push(lineEl(line, 'section', m[2]!, { depth: m[1]!.length }));
    } else if ((m = SYNOPSIS_RE.exec(v))) {
      elements.push(lineEl(line, 'synopsis', m[1]!));
    } else if ((m = CENTERED_RE.exec(v))) {
      elements.push(lineEl(line, 'centered', m[1]!, {}, v.indexOf('>') + 1));
    } else if ((m = FORCED_TRANSITION_RE.exec(v))) {
      elements.push(lineEl(line, 'transition', m[1]!, {}, v.indexOf('>') + 1));
    } else if (prevBlank && (/^\.[\p{L}\p{N}]/u.test(t) || SCENE_RE.test(t))) {
      let text = t.startsWith('.') ? t.slice(1) : t;
      const extra: Partial<FountainElement> = {};
      const sn = SCENE_NUMBER_RE.exec(text);
      if (sn) {
        extra.sceneNumber = sn[1]!;
        text = text.slice(0, sn.index);
      }
      elements.push(lineEl(line, 'scene_heading', text, extra, lead + (t.startsWith('.') ? 1 : 0)));
    } else if (t.startsWith('!')) {
      elements.push(lineEl(line, 'action', t.slice(1), {}, lead + 1));
    } else if (t.startsWith('~')) {
      elements.push(lineEl(line, 'lyrics', t.slice(1), {}, lead + 1));
    } else if (prevBlank && nextBlank && isUpper(t) && t.endsWith('TO:')) {
      elements.push(lineEl(line, 'transition', t, {}, lead));
    } else {
      const cue = prevBlank && !nextBlank ? parseCharacterCue(v) : null;
      if (cue) {
        elements.push(
          lineEl(line, 'character', cue.name, {
            character: cue.name,
            ...(cue.extension ? { extension: cue.extension } : {}),
            ...(cue.dual ? { dual: true } : {}),
          }),
        );
        dialogue = cue;
      } else {
        elements.push(lineEl(line, 'action', t, {}, lead));
      }
    }
  }

  elements.sort((a, b) => a.start - b.start);
  const anchorable: FountainElement[] = [];
  for (const el of elements) {
    if (ANCHORABLE_TYPES.has(el.type)) {
      el.ordinal = anchorable.length;
      anchorable.push(el);
    }
  }
  return { source, elements, lines: anchorable, titlePage };
}
