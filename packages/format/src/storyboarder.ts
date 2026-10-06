/**
 * Import from Wonder Unit's Storyboarder (`.storyboarder`, https://github.com/wonderunit/storyboarder).
 *
 * A Storyboarder scene is a JSON file next to an `images/` folder:
 *
 * ```json
 * { "version": "2.0.1", "aspectRatio": 1.7777, "fps": 24, "defaultBoardTiming": 2000,
 *   "boards": [{ "uid": "UDRF3", "url": "board-1-UDRF3.png", "number": 1, "shot": "1A",
 *     "duration": 1500, "dialogue": "MARA: Hello.", "action": "…", "notes": "…", "newShot": false,
 *     "layers": { "fill": { "url": "board-1-UDRF3-fill.png", "opacity": 1 }, … },
 *     "audio": { "filename": "UDRF3-audio-1513895986059.wav", "duration": 2400 } }] }
 * ```
 *
 * Mapping: every board becomes one shot (ID = board `uid`); drawing layers become one canvas
 * variant whose layers reference the PNGs (bottom → top: shot-generator, reference, fill, tone,
 * pencil, ink, notes; the notes layer is hidden); the flattened `-posterframe.jpg` becomes the
 * canvas preview; `action` and `dialogue` become Fountain lines of that shot; `notes` goes into
 * the `notes` field; durations (ms) become seconds; board audio becomes a shot cue.
 *
 * Pure: the caller passes the bytes of the files in `images/` (by file name).
 */
import { composeFountain } from './compose.js';
import { parseFountain } from './fountain.js';
import { isValidId, slugify } from './idgen.js';
import { addAsset, addCue, addShot, updateManifest } from './ops.js';
import { isPresetId, PRESETS, type PresetId } from './presets.js';
import { createProject } from './project.js';
import { mimeForPath, probeImageSize, probeWavDuration } from './media.js';
import type { CanvasVariant, FieldValue, Layer, SbdProject, Variant } from './types.js';

export interface StoryboarderLayer {
  url?: string;
  opacity?: number;
  [k: string]: unknown;
}

export interface StoryboarderBoard {
  uid?: string;
  url?: string;
  number?: number;
  shot?: string;
  newShot?: boolean;
  /** Milliseconds; missing = `defaultBoardTiming`. */
  duration?: number | string;
  dialogue?: string;
  action?: string;
  notes?: string;
  layers?: Record<string, StoryboarderLayer>;
  audio?: { filename?: string; duration?: number } | null;
  [k: string]: unknown;
}

export interface StoryboarderScene {
  version?: string;
  aspectRatio?: number | string;
  fps?: number | string;
  /** Milliseconds. */
  defaultBoardTiming?: number | string;
  boards: StoryboarderBoard[];
  [k: string]: unknown;
}

export interface StoryboarderImportOptions {
  title: string;
  /** Default `film`. */
  preset?: PresetId;
  /** Bytes of the files in the scene's `images/` folder, keyed by file name. */
  files: ReadonlyMap<string, Uint8Array>;
  /** Character used for dialogue without a `NAME:` prefix. Default `VOICE`. */
  defaultCharacter?: string;
  now?: Date;
}

export interface StoryboarderImportResult {
  project: SbdProject;
  /** Files to write into the package (`media/<name>` → bytes). */
  media: Record<string, Uint8Array>;
  warnings: string[];
}

/** Storyboarder's layer stack, bottom first (see boardOrderedLayerFilenames in Storyboarder). */
export const STORYBOARDER_LAYERS = [
  'shot-generator',
  'reference',
  'fill',
  'tone',
  'pencil',
  'ink',
  'notes',
] as const;

const LAYER_LABELS: Record<string, string> = {
  'shot-generator': 'Shot Generator',
  reference: 'Reference',
  fill: 'Fill',
  tone: 'Tone',
  pencil: 'Pencil',
  ink: 'Ink',
  notes: 'Notes',
};

const COMMON_RATIOS: Array<[number, string]> = [
  [16 / 9, '16:9'],
  [9 / 16, '9:16'],
  [4 / 3, '4:3'],
  [3 / 4, '3:4'],
  [1, '1:1'],
  [1.85, '1.85:1'],
  [2, '2:1'],
  [2.35, '2.35:1'],
  [2.39, '2.39:1'],
  [4 / 5, '4:5'],
];

/** "16:9" for 1.7777…, "2.39:1" for 2.39, "1.66:1" for others. */
export function aspectRatioString(ar: number): string {
  if (!(ar > 0)) return '16:9';
  for (const [v, s] of COMMON_RATIOS) if (Math.abs(v - ar) < 0.005) return s;
  return ar >= 1 ? `${Math.round(ar * 100) / 100}:1` : `1:${Math.round((1 / ar) * 100) / 100}`;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Throws a readable error when `data` does not look like a Storyboarder scene. */
export function parseStoryboarderScene(data: unknown): StoryboarderScene {
  const obj = typeof data === 'string' ? (JSON.parse(data) as unknown) : data;
  if (!obj || typeof obj !== 'object' || !Array.isArray((obj as StoryboarderScene).boards)) {
    throw new Error('Not a Storyboarder scene: expected a JSON object with a "boards" array');
  }
  return obj as StoryboarderScene;
}

/**
 * Splits Storyboarder dialogue ("MARA (V.O.): Hello." or just "Hello.") into character,
 * extension and text.
 */
export function splitDialogue(
  dialogue: string,
  fallbackCharacter = 'VOICE',
): { character: string; extension?: string; text: string } {
  const m = /^\s*([^:\n]{1,40}?)\s*:\s*([\s\S]+)$/.exec(dialogue);
  // Storyboarder writes "NAME: text" (names in capitals, as in the script).
  if (m && /\p{Lu}/u.test(m[1]!) && !/\p{Ll}/u.test(m[1]!.replace(/\([^)]*\)/g, ''))) {
    const ext = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(m[1]!);
    return ext
      ? { character: ext[1]!, extension: ext[2]!, text: m[2]!.trim() }
      : { character: m[1]!, text: m[2]!.trim() };
  }
  return { character: fallbackCharacter, text: dialogue.trim() };
}

interface Segment {
  board: number;
  text: string;
  lines: number;
}

export function projectFromStoryboarder(
  data: unknown,
  opts: StoryboarderImportOptions,
): StoryboarderImportResult {
  const scene = parseStoryboarderScene(data);
  const warnings: string[] = [];
  const media: Record<string, Uint8Array> = {};
  const preset: PresetId = opts.preset && isPresetId(opts.preset) ? opts.preset : 'film';
  const ar = num(scene.aspectRatio) ?? 16 / 9;
  const boardMs = (b: StoryboarderBoard) =>
    num(b.duration) ?? num(scene.defaultBoardTiming) ?? 2000;

  // --- script: action then dialogue for every board
  const segments: Segment[] = [];
  scene.boards.forEach((b, i) => {
    const add = (text: string) => {
      const lines = parseFountain(`${text}\n`).lines.length;
      if (lines) segments.push({ board: i, text, lines });
    };
    try {
      if (b.action?.trim()) add(composeFountain({ type: 'action', text: b.action }));
      if (b.dialogue?.trim()) {
        const d = splitDialogue(b.dialogue, opts.defaultCharacter ?? 'VOICE');
        add(
          composeFountain({
            type: 'dialogue',
            character: d.character,
            text: d.text,
            ...(d.extension ? { extension: d.extension } : {}),
          }),
        );
      }
    } catch (e) {
      warnings.push(`Board ${i + 1}: text skipped (${(e as Error).message})`);
    }
  });
  const script = segments.length
    ? `Title: ${opts.title}\n\n${segments.map((s) => s.text).join('\n\n')}\n`
    : null;

  let p = createProject({
    title: opts.title,
    preset,
    aspect_ratio: aspectRatioString(ar),
    script,
    ...(opts.now ? { now: opts.now } : {}),
  });
  const fps = num(scene.fps);
  const defaultMs = num(scene.defaultBoardTiming);
  p = updateManifest(p, {
    ...(fps && fps > 0 ? { fps } : {}),
    ...(defaultMs && defaultMs > 0 ? { default_shot_duration: round3(defaultMs / 1000) } : {}),
    generator: `storyboard-viewer (imported from Storyboarder ${scene.version ?? ''})`.replace(
      ' )',
      ')',
    ),
  });

  // Line IDs per board, in script order.
  const boardLines = new Map<number, string[]>();
  const expected = segments.reduce((s, x) => s + x.lines, 0);
  if (expected !== p.ids.lines.length) {
    warnings.push(
      `Script lines could not be matched to boards (${p.ids.lines.length} vs ${expected}); lines are left unassigned.`,
    );
  } else {
    let o = 0;
    for (const s of segments) {
      const list = boardLines.get(s.board) ?? [];
      for (let k = 0; k < s.lines; k++) list.push(p.ids.lines[o++]!.id);
      boardLines.set(s.board, list);
    }
  }

  // --- media helpers
  const usedAssets = new Set<string>();
  const assetFor = (
    file: string,
    kind: 'image' | 'audio',
    name: string,
    extra: { category?: string; tags?: string[] } = {},
  ): { id: string; width?: number; height?: number; duration?: number } | null => {
    const bytes = opts.files.get(file);
    if (!bytes) return null;
    const path = `media/${file}`;
    let id = slugify(file.replace(/\.[^.]+$/, ''), 'asset');
    for (let n = 2; usedAssets.has(id); n++) id = `${slugify(file, 'asset')}-${n}`;
    usedAssets.add(id);
    const info: { width?: number; height?: number; duration?: number } = {};
    if (kind === 'image') Object.assign(info, probeImageSize(bytes) ?? {});
    else {
      const d = probeWavDuration(bytes);
      if (d !== null) info.duration = round3(d);
    }
    p = addAsset(p, {
      id,
      name,
      kind,
      src: path,
      mime: mimeForPath(file),
      size: bytes.length,
      ...(extra.category ? { category: extra.category } : {}),
      ...(extra.tags ? { tags: extra.tags } : {}),
      ...info,
    }).project;
    media[path] = bytes;
    return { id, ...info };
  };

  const audioCategory =
    p.manifest.categories?.find((c) => c.id === 'dialogue' || c.id === 'voiceover')?.id ??
    p.manifest.categories?.find((c) => c.kinds?.includes('audio'))?.id;
  const hasNotesField = p.manifest.shot_fields?.some((f) => f.id === 'notes') ?? false;
  if (!hasNotesField) {
    p = updateManifest(p, {
      shot_fields: [
        ...(p.manifest.shot_fields ?? []),
        { id: 'notes', label: 'Notes', type: 'longtext' },
      ],
    });
  }
  let canvasSize: { width: number; height: number } | null = null;
  const usedShots = new Set<string>();

  scene.boards.forEach((b, i) => {
    const label = b.shot ? String(b.shot) : String(b.number ?? i + 1);
    let id = b.uid && isValidId(b.uid) ? b.uid : `board-${i + 1}`;
    for (let n = 2; usedShots.has(id); n++) id = `${b.uid ?? 'board'}-${n}`;
    usedShots.add(id);
    const tag = `Board ${label}`;

    // Layers (bottom → top). Pre-1.6 scenes keep the main drawing in board.url (= fill).
    const layers: Record<string, StoryboarderLayer> = { ...b.layers };
    if (b.url && !layers['fill'] && opts.files.has(b.url)) layers['fill'] = { url: b.url };
    const order = [
      ...STORYBOARDER_LAYERS.filter((n) => layers[n]),
      ...Object.keys(layers).filter((n) => !(STORYBOARDER_LAYERS as readonly string[]).includes(n)),
    ];
    const sbdLayers: Layer[] = [];
    for (const name of order) {
      const l = layers[name]!;
      if (!l.url) continue;
      const a = assetFor(l.url, 'image', `${tag} · ${LAYER_LABELS[name] ?? name}`, {
        category: 'drawing',
        tags: ['storyboarder', name],
      });
      if (!a) {
        warnings.push(`Board ${label}: layer file images/${l.url} is missing`);
        continue;
      }
      if (!canvasSize && a.width && a.height) canvasSize = { width: a.width, height: a.height };
      const layer: Layer = {
        id: slugify(name, 'layer'),
        asset: a.id,
        name: LAYER_LABELS[name] ?? name,
      };
      const op = num(l.opacity);
      if (op !== undefined && op < 1) layer.opacity = Math.max(0, op);
      if (name === 'notes') layer.visible = false;
      sbdLayers.push(layer);
    }
    const posterName = b.url ? b.url.replace(/\.png$/i, '-posterframe.jpg') : undefined;
    const poster =
      posterName && opts.files.has(posterName)
        ? assetFor(posterName, 'image', `${tag} · Board`, {
            category: 'drawing',
            tags: ['storyboarder', 'posterframe'],
          })
        : null;
    if (poster && !canvasSize && poster.width && poster.height)
      canvasSize = { width: poster.width, height: poster.height };

    const variants: Variant[] = [];
    if (sbdLayers.length) {
      const v: CanvasVariant = {
        id: 'drawing',
        type: 'canvas',
        name: 'Drawing',
        background: '#ffffff',
        layers: sbdLayers,
      };
      if (poster) v.preview = poster.id;
      variants.push(v);
    } else if (poster) {
      variants.push({ id: 'drawing', type: 'image', name: 'Drawing', asset: poster.id });
    } else {
      warnings.push(`Board ${label}: no drawing found`);
    }

    // Audio
    let audioMs = 0;
    let audioAsset: string | undefined;
    if (b.audio?.filename) {
      const a = assetFor(b.audio.filename, 'audio', `${tag} · Audio`, {
        ...(audioCategory ? { category: audioCategory } : {}),
        tags: ['storyboarder'],
      });
      if (!a) warnings.push(`Board ${label}: audio file images/${b.audio.filename} is missing`);
      else {
        audioAsset = a.id;
        audioMs = num(b.audio.duration) ?? (a.duration ? a.duration * 1000 : 0);
      }
    }

    const fields: Record<string, FieldValue> = {};
    if (b.notes?.trim()) fields['notes'] = b.notes.trim();
    const r = addShot(p, {
      id,
      title: `Shot ${label}`,
      fields,
      duration: round3(Math.max(boardMs(b), audioMs) / 1000) || 0.001,
      ...(b.newShot ? { tags: ['new-shot'] } : {}),
      variants,
      lines: boardLines.get(i) ?? [],
    });
    p = r.project;
    if (audioAsset)
      p = addCue(p, { asset: audioAsset, target: { shot: id }, track: 'audio' }).project;
  });

  const size = canvasSize as { width: number; height: number } | null;
  if (size) p = updateManifest(p, { canvas: size });
  else {
    p = updateManifest(p, {
      canvas:
        ar >= 1
          ? { width: Math.round(900 * ar), height: 900 }
          : { width: 900, height: Math.round(900 / ar) },
    });
  }
  if (!PRESETS[preset].categories.some((c) => c.id === 'drawing')) {
    p = updateManifest(p, {
      categories: [
        { id: 'drawing', label: 'Drawing', kinds: ['image'] },
        ...(p.manifest.categories ?? []),
      ],
    });
  }
  return { project: p, media, warnings };
}
