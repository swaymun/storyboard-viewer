/**
 * TypeScript types for the SBD files. Hand-written mirrors of `schema/*.schema.json` (the source of
 * truth); `test/schemas.test.ts` validates typed fixtures and the example projects against the
 * schemas so the two stay in sync. JSON property names are snake_case on purpose (agents and
 * humans edit these files directly).
 *
 * Readers must ignore unknown properties, so every object type allows extra keys.
 */
import type { LineIdEntry } from './reanchor.js';

export type { LineIdEntry };

/** Current spec version written by this package. */
export const FORMAT_VERSION = '0.3.0';

export type AssetKind = 'image' | 'audio' | 'video' | 'font';
export const ASSET_KINDS: readonly AssetKind[] = ['image', 'audio', 'video', 'font'];

type Extra = { [key: string]: unknown };

export interface CategoryDef extends Extra {
  id: string;
  label: string;
  kinds?: AssetKind[];
  color?: string;
}

export type ShotFieldType = 'text' | 'longtext' | 'number' | 'boolean' | 'select';

export interface ShotFieldDef extends Extra {
  id: string;
  label: string;
  type?: ShotFieldType;
  options?: string[];
  placeholder?: string;
  description?: string;
}

export interface Manifest extends Extra {
  format: 'sbd';
  format_version: string;
  title: string;
  description?: string;
  authors?: string[];
  language?: string;
  preset?: string;
  aspect_ratio?: string;
  canvas?: { width: number; height: number };
  fps?: number;
  default_shot_duration?: number;
  categories?: CategoryDef[];
  shot_fields?: ShotFieldDef[];
  created?: string;
  modified?: string;
  generator?: string;
}

/** A character position in a script line: `offset` counts UTF-16 code units of the line's text. */
export interface SpanPoint extends Extra {
  line: string;
  offset: number;
}

/**
 * A shot in story order with the script lines it covers. `start` / `end` (format 0.2) narrow the
 * first / last line to a character range (`end` exclusive); omitted = the whole line.
 */
export interface ShotRef extends Extra {
  id: string;
  lines: string[];
  start?: SpanPoint;
  end?: SpanPoint;
}

export interface IdsFile extends Extra {
  script_hash?: string | null;
  lines: LineIdEntry[];
  shots: ShotRef[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Known filter types (CSS filter semantics). Unknown types must be ignored by renderers. */
export type KnownFilterType =
  'blur' | 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'invert' | 'hue_rotate';

export const KNOWN_FILTERS: readonly KnownFilterType[] = [
  'blur',
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
  'sepia',
  'invert',
  'hue_rotate',
];

export interface LayerFilter extends Extra {
  type: KnownFilterType | (string & {});
  value?: number;
}

/** What a layer draws (format 0.3). Omitted = `image` (every 0.1/0.2 layer). */
export type LayerKind = 'image' | 'text' | 'slot';
export const LAYER_KINDS: readonly LayerKind[] = ['image', 'text', 'slot'];

/** How an image sits in a slot: `cover` fills it (cropping), `contain` shows all of it. */
export type SlotFit = 'cover' | 'contain';

/**
 * Format 0.3: the slot an image layer fills (the frame it was fitted into). The layer's own
 * `x/y/width/height/crop` already place the picture, so readers that ignore `slot` still draw it
 * right; editors use it to re-fit (Fit / Fill) and to turn the layer back into an empty slot.
 */
export interface SlotFrame extends Extra {
  x: number;
  y: number;
  width: number;
  height: number;
  fit?: SlotFit;
  /** The slot's label ("Top", "B-roll"). */
  name?: string;
}

export interface TextStroke extends Extra {
  color: string;
  /** Canvas px. */
  width: number;
}

export interface TextShadow extends Extra {
  color: string;
  /** Canvas px. */
  blur?: number;
  offset_x?: number;
  offset_y?: number;
}

export interface TextBox extends Extra {
  /** CSS color behind the text (each line gets its own box). */
  color: string;
  /** Canvas px around the text. Default: 0.3 × font size. */
  padding?: number;
  /** Canvas px. Default: 0.2 × font size. */
  radius?: number;
}

export type TextAlign = 'left' | 'center' | 'right';

/**
 * A canvas layer. Attribute semantics match Konva (x/y = origin, rotation in degrees).
 *
 * - **image** (default; `kind` omitted): `asset` is an image or video; `crop`, `filters`, and
 *   (0.3) `slot` when it was fitted into a layout slot.
 * - **text** (0.3): `text` drawn in a box `width` wide (lines wrap; the height follows the
 *   text), with `font`/`font_asset`, `font_size`, `font_weight`, `color`, `align`, `stroke`,
 *   `shadow`, `box`. `style` names the caption style it was made from (informational).
 * - **slot** (0.3): an empty, named placeholder (`width` × `height`) from a layout. Editors show it;
 *   renderers of the finished frame (cards, animatic, PDF, video) draw nothing.
 *
 * `group` (0.3): layers with the same group ID move, select and duplicate together.
 */
export interface Layer extends Extra {
  id: string;
  kind?: LayerKind;
  /** Image layers: the image (or video) asset. */
  asset?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  scale_x?: number;
  scale_y?: number;
  rotation?: number;
  opacity?: number;
  crop?: CropRect;
  filters?: LayerFilter[];
  visible?: boolean;
  locked?: boolean;
  group?: string;
  slot?: SlotFrame;
  fit?: SlotFit;
  text?: string;
  font?: string;
  font_asset?: string;
  font_size?: number;
  font_weight?: number;
  italic?: boolean;
  uppercase?: boolean;
  color?: string;
  align?: TextAlign;
  line_height?: number;
  stroke?: TextStroke;
  shadow?: TextShadow;
  box?: TextBox;
  style?: string;
}

/** The kind of a layer (`image` when omitted). */
export function layerKind(l: Pick<Layer, 'kind'>): LayerKind | (string & {}) {
  return l.kind ?? 'image';
}

export interface ImageVariant extends Extra {
  id: string;
  type: 'image';
  name?: string;
  notes?: string;
  asset: string;
}

export interface CanvasVariant extends Extra {
  id: string;
  type: 'canvas';
  name?: string;
  notes?: string;
  width?: number;
  height?: number;
  background?: string;
  preview?: string;
  layers: Layer[];
}

export type Variant = ImageVariant | CanvasVariant;

export type FieldValue = string | number | boolean | null;

export interface Shot extends Extra {
  id: string;
  title?: string;
  fields?: Record<string, FieldValue>;
  duration?: number;
  tags?: string[];
  variants?: Variant[];
  active_variant?: string | null;
}

export interface AssetRendition extends Extra {
  src: string;
  mime?: string;
  width?: number;
  height?: number;
  label?: string;
  role?: string;
}

export interface Asset extends Extra {
  id: string;
  name: string;
  kind: AssetKind;
  category?: string;
  tags?: string[];
  src: string;
  mime?: string;
  duration?: number;
  width?: number;
  height?: number;
  poster?: string;
  sha256?: string;
  size?: number;
  variants?: AssetRendition[];
  notes?: string;
  credit?: string;
  license?: string;
}

export interface AssetsFile extends Extra {
  assets: Asset[];
}

export type CueTarget =
  | { line: string }
  | { shot: string }
  | { range: [string, string] }
  | { global: { start?: number } };

export interface Cue extends Extra {
  id: string;
  asset: string;
  in?: number;
  out?: number;
  target: CueTarget;
  offset?: number;
  gain?: number;
  track?: string;
  fade_in?: number;
  fade_out?: number;
  loop?: boolean;
  label?: string;
}

export interface TrackDef extends Extra {
  id: string;
  label?: string;
  gain?: number;
  muted?: boolean;
}

export interface Timeline extends Extra {
  tracks?: TrackDef[];
  cues: Cue[];
}

/**
 * In-memory project model. Plain JSON data (structured-cloneable) so it can be diffed, stored in
 * IndexedDB and used for undo/redo. Media bytes are not part of the model.
 */
export interface SbdProject {
  manifest: Manifest;
  /** Contents of script.fountain, or null when the project has no script. */
  script: string | null;
  ids: IdsFile;
  /** Shot files keyed by shot ID. Order and lines live in `ids.shots`. */
  shots: Record<string, Shot>;
  assets: AssetsFile;
  timeline: Timeline;
}

export function isLineTarget(t: CueTarget): t is { line: string } {
  return typeof (t as { line?: unknown }).line === 'string';
}
export function isShotTarget(t: CueTarget): t is { shot: string } {
  return typeof (t as { shot?: unknown }).shot === 'string';
}
export function isRangeTarget(t: CueTarget): t is { range: [string, string] } {
  return Array.isArray((t as { range?: unknown }).range);
}
export function isGlobalTarget(t: CueTarget): t is { global: { start?: number } } {
  const g = (t as { global?: unknown }).global;
  return typeof g === 'object' && g !== null;
}

type StripIndex<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** `T` with an optional `id` (generated when omitted). Distributes over unions. */
export type WithOptionalId<T> = T extends unknown
  ? Omit<StripIndex<T>, 'id'> & { id?: string } & Extra
  : never;
