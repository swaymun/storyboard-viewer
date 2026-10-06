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
export const FORMAT_VERSION = '0.2.0';

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

/** A canvas layer. Attribute semantics match Konva.Image (x/y = origin, rotation in degrees). */
export interface Layer extends Extra {
  id: string;
  asset: string;
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
