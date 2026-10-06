/**
 * Canvas layouts (format 0.3): ready-made arrangements of named slots (and placeholder text)
 * per frame shape, caption styles for text layers, and the slot operations that fit an image
 * into a slot. Shared by the app, the MCP tools and the tests so they all place things alike.
 *
 * Layout geometry is in fractions of the frame (0…1) and becomes canvas pixels when applied.
 */
import { newId } from './idgen.js';
import { aspectValue } from './presets.js';
import {
  addVariant,
  getCanvas,
  SbdEditError,
  updateLayers,
  updateVariant,
  type LayerInput,
  type LayerPatch,
} from './ops.js';
import {
  layerKind,
  type Asset,
  type CanvasVariant,
  type Layer,
  type Manifest,
  type SbdProject,
  type SlotFit,
  type SlotFrame,
} from './types.js';

const fail = (msg: string): never => {
  throw new SbdEditError(msg);
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Canvas size of a composition: its own size, else the manifest canvas, else from the aspect. */
export function canvasSizeOf(
  v: Pick<CanvasVariant, 'width' | 'height'>,
  m: Manifest | undefined,
): { width: number; height: number } {
  if (v.width && v.height) return { width: v.width, height: v.height };
  if (m?.canvas) return m.canvas;
  const a = aspectValue(m?.aspect_ratio);
  return a >= 1
    ? { width: 1920, height: Math.round(1920 / a) }
    : { width: Math.round(1920 * a), height: 1920 };
}

/** Frame shapes layouts are made for. */
export type AspectClass = 'vertical' | 'portrait' | 'square' | 'landscape';

/** 9:16 and taller = vertical; 4:5-ish = portrait; about 1:1 = square; wider = landscape. */
export function aspectClass(width: number, height: number): AspectClass {
  const r = width / height;
  if (r < 0.7) return 'vertical';
  if (r < 0.92) return 'portrait';
  if (r <= 1.08) return 'square';
  return 'landscape';
}

// ---------------------------------------------------------------------------
// Caption styles

export type CaptionStyleId = 'bold' | 'boxed' | 'lower-third' | 'title' | 'subtitle';

export interface CaptionStyle {
  id: CaptionStyleId;
  label: string;
  description: string;
}

export const CAPTION_STYLES: readonly CaptionStyle[] = [
  {
    id: 'bold',
    label: 'Bold',
    description: 'Short-form captions: heavy white text with a dark outline and shadow',
  },
  { id: 'boxed', label: 'Boxed', description: 'Dark text on white boxes, one box per line' },
  { id: 'lower-third', label: 'Lower third', description: 'Name / title on a dark band, left' },
  { id: 'title', label: 'Title', description: 'Big capitals for title cards and hooks' },
  { id: 'subtitle', label: 'Subtitle', description: 'Plain white text with a soft shadow' },
];

/** Bundled font families every renderer of this app can draw (the app ships them). */
export const BUNDLED_FONTS = ['IBM Plex Sans', 'Montserrat', 'Courier Prime', 'IBM Plex Mono'];

export const TEXT_DEFAULTS = {
  font: 'IBM Plex Sans',
  font_size: 64,
  font_weight: 400,
  color: '#ffffff',
  align: 'center',
  line_height: 1.2,
} as const;

/** Text attributes of a caption style for a frame of this size (sizes scale with the frame). */
export function captionStyle(
  id: CaptionStyleId | (string & {}),
  frame: { width: number; height: number },
): LayerPatch {
  const u = Math.min(frame.width, frame.height);
  const px = (k: number) => Math.round(u * k);
  const reset: LayerPatch = {
    style: id,
    uppercase: null,
    italic: null,
    stroke: null,
    shadow: null,
    box: null,
  };
  switch (id) {
    case 'bold': {
      const size = px(0.068);
      return {
        ...reset,
        font: 'Montserrat',
        font_weight: 800,
        font_size: size,
        color: '#ffffff',
        align: 'center',
        line_height: 1.15,
        stroke: { color: '#000000', width: Math.max(2, Math.round(size * 0.09)) },
        shadow: {
          color: 'rgba(0,0,0,0.55)',
          blur: Math.round(size * 0.18),
          offset_x: 0,
          offset_y: Math.round(size * 0.06),
        },
      };
    }
    case 'boxed': {
      const size = px(0.05);
      return {
        ...reset,
        font: 'IBM Plex Sans',
        font_weight: 600,
        font_size: size,
        color: '#111111',
        align: 'center',
        line_height: 1.35,
        box: { color: '#ffffff', padding: Math.round(size * 0.3), radius: Math.round(size * 0.2) },
      };
    }
    case 'lower-third': {
      const size = px(0.042);
      return {
        ...reset,
        font: 'IBM Plex Sans',
        font_weight: 600,
        font_size: size,
        color: '#ffffff',
        align: 'left',
        line_height: 1.3,
        box: {
          color: 'rgba(12,14,18,0.72)',
          padding: Math.round(size * 0.4),
          radius: Math.round(size * 0.12),
        },
      };
    }
    case 'title': {
      const size = px(0.1);
      return {
        ...reset,
        font: 'Montserrat',
        font_weight: 800,
        font_size: size,
        color: '#ffffff',
        align: 'center',
        line_height: 1.05,
        uppercase: true,
        shadow: { color: 'rgba(0,0,0,0.45)', blur: Math.round(size * 0.2), offset_y: 0 },
      };
    }
    case 'subtitle': {
      const size = px(0.045);
      return {
        ...reset,
        font: 'IBM Plex Sans',
        font_weight: 500,
        font_size: size,
        color: '#ffffff',
        align: 'center',
        line_height: 1.25,
        shadow: {
          color: 'rgba(0,0,0,0.8)',
          blur: Math.round(size * 0.25),
          offset_y: Math.round(size * 0.04),
        },
      };
    }
    default:
      return fail(
        `Unknown caption style "${id}" (use ${CAPTION_STYLES.map((s) => s.id).join(', ')})`,
      );
  }
}

/** Where `addTextLayer` puts text (vertical frames keep clear of the platforms' buttons). */
export type TextPosition = 'top' | 'middle' | 'bottom' | 'lower-third';

function textBox(
  pos: TextPosition,
  frame: { width: number; height: number },
): { x: number; y: number; width: number } {
  const { width: W, height: H } = frame;
  const vertical = aspectClass(W, H) === 'vertical';
  if (pos === 'lower-third') return { x: r2(W * 0.07), y: r2(H * 0.72), width: r2(W * 0.55) };
  const y =
    pos === 'top' ? (vertical ? 0.14 : 0.1) : pos === 'middle' ? 0.45 : vertical ? 0.64 : 0.8;
  return { x: r2(W * 0.08), y: r2(H * y), width: r2(W * 0.84) };
}

export interface AddTextInput extends Partial<Omit<Layer, 'kind' | 'text'>> {
  text: string;
  style?: CaptionStyleId | (string & {});
  position?: TextPosition;
}

/** Text layer attributes for a caption style at a position (not yet added). */
export function textLayerInput(
  input: AddTextInput,
  frame: { width: number; height: number },
): LayerInput {
  const { style = 'bold', position, ...rest } = input;
  const styled = captionStyle(style, frame);
  for (const k of Object.keys(styled)) if (styled[k] === null) delete styled[k];
  const pos =
    position ?? (style === 'lower-third' ? 'lower-third' : style === 'title' ? 'middle' : 'bottom');
  return {
    kind: 'text',
    ...textBox(pos, frame),
    ...(styled as Partial<Layer>),
    ...rest,
    text: input.text,
  } as LayerInput;
}

// ---------------------------------------------------------------------------
// Slots

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Places an image in a slot frame: `cover` fills the frame and crops the overflow (centered),
 * `contain` shows the whole image centered inside it. Without the image's size the image is
 * stretched to the frame. The result replaces the layer's position, size, scale, crop.
 */
export function slotPlacement(
  frame: SlotFrame,
  image: ImageSize | null,
  fit: SlotFit = frame.fit ?? 'cover',
): LayerPatch {
  const base: LayerPatch = { scale_x: null, scale_y: null };
  if (!image || !(image.width > 0) || !(image.height > 0))
    return {
      ...base,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      crop: null,
    };
  const { width: iw, height: ih } = image;
  if (fit === 'contain') {
    const k = Math.min(frame.width / iw, frame.height / ih);
    const w = iw * k;
    const h = ih * k;
    return {
      ...base,
      x: r2(frame.x + (frame.width - w) / 2),
      y: r2(frame.y + (frame.height - h) / 2),
      width: r2(w),
      height: r2(h),
      crop: null,
    };
  }
  const k = Math.max(frame.width / iw, frame.height / ih);
  const cw = Math.min(iw, frame.width / k);
  const ch = Math.min(ih, frame.height / k);
  const crop = { x: r2((iw - cw) / 2), y: r2((ih - ch) / 2), width: r2(cw), height: r2(ch) };
  const full = crop.x === 0 && crop.y === 0 && crop.width === iw && crop.height === ih;
  return {
    ...base,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    crop: full ? null : crop,
  };
}

/** The slot frame of a layer: an empty slot's own box, or the slot a picture was fitted into. */
export function slotFrameOf(l: Layer): SlotFrame | null {
  if (layerKind(l) === 'slot') {
    const f: SlotFrame = {
      x: l.x ?? 0,
      y: l.y ?? 0,
      width: (l.width ?? 0) * Math.abs(l.scale_x ?? 1),
      height: (l.height ?? 0) * Math.abs(l.scale_y ?? 1),
    };
    if (l.fit) f.fit = l.fit;
    if (l.name) f.name = l.name;
    return f;
  }
  return l.slot ?? null;
}

const imageSize = (a: Asset | undefined): ImageSize | null =>
  a?.width && a.height ? { width: a.width, height: a.height } : null;

/** Layer that fills slot `frame` with `asset` (keeping id, group, opacity, filters, visibility). */
function filledLayer(old: Layer, frame: SlotFrame, asset: Asset, fit: SlotFit): Layer {
  const keep: Partial<Layer> = {};
  for (const k of ['opacity', 'visible', 'locked', 'group', 'filters'] as const)
    if (old[k] !== undefined) (keep as Record<string, unknown>)[k] = old[k];
  if (layerKind(old) === 'image' && old.name) keep.name = old.name;
  const placed = slotPlacement(frame, imageSize(asset), fit);
  const layer: Layer = { id: old.id, asset: asset.id, ...keep };
  for (const [k, v] of Object.entries(placed)) if (v !== null) layer[k] = v;
  const slot: SlotFrame = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  if (fit !== 'cover') slot.fit = fit;
  if (frame.name) slot.name = frame.name;
  layer.slot = slot;
  return layer;
}

function replaceLayer(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
  make: (old: Layer) => Layer,
): SbdProject {
  const v = getCanvas(p, shotId, variantId);
  if (!v.layers.some((l) => l.id === layerId)) fail(`Unknown layer "${layerId}"`);
  return updateVariant(p, shotId, variantId, {
    layers: v.layers.map((l) => (l.id === layerId ? make(l) : l)),
  });
}

/** Finds a slot layer by ID or by its slot name (case-insensitive). */
export function findSlot(v: CanvasVariant, idOrName: string): Layer | undefined {
  const byId = v.layers.find((l) => l.id === idOrName && slotFrameOf(l));
  if (byId) return byId;
  const n = idOrName.trim().toLowerCase();
  return v.layers.find((l) => slotFrameOf(l)?.name?.toLowerCase() === n);
}

/**
 * Puts an image into a slot (an empty slot layer, or a slot that already has a picture: the
 * picture is replaced). `fit` defaults to the slot's fit, else cover.
 */
export function fillSlot(
  p: SbdProject,
  shotId: string,
  variantId: string,
  slotId: string,
  assetId: string,
  fit?: SlotFit,
): SbdProject {
  const asset = p.assets.assets.find((a) => a.id === assetId) ?? fail(`Unknown asset "${assetId}"`);
  if (asset!.kind !== 'image' && asset!.kind !== 'video')
    fail(`Asset "${assetId}" is ${asset!.kind}; slots take images or videos`);
  const v = getCanvas(p, shotId, variantId);
  const slot = findSlot(v, slotId) ?? fail(`No slot "${slotId}" in variant "${variantId}"`);
  const frame = slotFrameOf(slot!)!;
  return replaceLayer(p, shotId, variantId, slot!.id, (old) =>
    filledLayer(old, frame, asset!, fit ?? frame.fit ?? 'cover'),
  );
}

/** Takes the picture out of a slot: the layer becomes the empty slot again. */
export function clearSlot(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
): SbdProject {
  return replaceLayer(p, shotId, variantId, layerId, (old) => {
    const f = old.slot ?? fail(`Layer "${layerId}" is not in a slot`);
    const l: Layer = {
      id: old.id,
      kind: 'slot',
      x: f!.x,
      y: f!.y,
      width: f!.width,
      height: f!.height,
    };
    if (f!.name) l.name = f!.name;
    if (f!.fit) l.fit = f!.fit;
    for (const k of ['group', 'locked', 'visible'] as const)
      if (old[k] !== undefined) (l as Record<string, unknown>)[k] = old[k];
    return l;
  });
}

/** Re-fits a slotted picture (cover = fill the slot, contain = show all of it). */
export function setSlotFit(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
  fit: SlotFit,
): SbdProject {
  const v = getCanvas(p, shotId, variantId);
  const l = v.layers.find((x) => x.id === layerId) ?? fail(`Unknown layer "${layerId}"`);
  if (layerKind(l!) === 'slot')
    return updateLayers(p, shotId, variantId, { [layerId]: { fit: fit === 'cover' ? null : fit } });
  const frame = l!.slot ?? fail(`Layer "${layerId}" is not in a slot`);
  const asset = p.assets.assets.find((a) => a.id === l!.asset);
  const patch = slotPlacement(frame!, imageSize(asset), fit);
  const slot: SlotFrame = { ...frame! };
  if (fit === 'cover') delete slot.fit;
  else slot.fit = fit;
  return updateLayers(p, shotId, variantId, { [layerId]: { ...patch, slot } });
}

/**
 * Moves / resizes a slot frame (canvas px) and re-places its picture in it with the same fit.
 * The editor calls it when a slotted picture is dragged or resized.
 */
export function setSlotFrame(
  p: SbdProject,
  shotId: string,
  variantId: string,
  layerId: string,
  frame: { x: number; y: number; width: number; height: number },
  extra: LayerPatch = {},
): SbdProject {
  const v = getCanvas(p, shotId, variantId);
  const l = v.layers.find((x) => x.id === layerId) ?? fail(`Unknown layer "${layerId}"`);
  const f = { x: r2(frame.x), y: r2(frame.y), width: r2(frame.width), height: r2(frame.height) };
  if (!(f.width > 0) || !(f.height > 0)) fail('A slot needs a positive size');
  if (layerKind(l!) === 'slot')
    return updateLayers(p, shotId, variantId, {
      [layerId]: { ...f, scale_x: null, scale_y: null, ...extra },
    });
  const old = l!.slot ?? fail(`Layer "${layerId}" is not in a slot`);
  const slot: SlotFrame = { ...old!, ...f };
  const asset = p.assets.assets.find((a) => a.id === l!.asset);
  const patch = slotPlacement(slot, imageSize(asset), slot.fit ?? 'cover');
  return updateLayers(p, shotId, variantId, { [layerId]: { ...patch, slot, ...extra } });
}

// ---------------------------------------------------------------------------
// Layouts

export interface LayoutSlotDef {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutTextDef {
  name: string;
  text: string;
  style: CaptionStyleId;
  x: number;
  y: number;
  w: number;
}

export interface LayoutDef {
  id: string;
  name: string;
  description: string;
  aspects: AspectClass[];
  /** Canvas background for the layout (e.g. the band of a caption layout). */
  background?: string;
  slots: LayoutSlotDef[];
  texts?: LayoutTextDef[];
}

const full = (name = 'Main'): LayoutSlotDef => ({ name, x: 0, y: 0, w: 1, h: 1 });

export const LAYOUTS: readonly LayoutDef[] = [
  // vertical 9:16 (TikTok, Reels, Shorts)
  {
    id: 'full-bleed',
    name: 'Full bleed',
    description: 'One picture fills the whole frame',
    aspects: ['vertical'],
    slots: [full()],
  },
  {
    id: 'split',
    name: 'Split top / bottom',
    description: 'Two pictures stacked: reaction, before / after',
    aspects: ['vertical'],
    slots: [
      { name: 'Top', x: 0, y: 0, w: 1, h: 0.5 },
      { name: 'Bottom', x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: 'picture-in-picture',
    name: 'Picture in picture',
    description: 'A full-frame picture with a small inset in the corner',
    aspects: ['vertical'],
    slots: [full(), { name: 'Inset', x: 0.56, y: 0.13, w: 0.38, h: 0.285 }],
  },
  {
    id: 'caption-band',
    name: 'Bottom caption band',
    description: 'Picture on top, a solid band with a caption below',
    aspects: ['vertical'],
    background: '#101114',
    slots: [{ name: 'Main', x: 0, y: 0, w: 1, h: 0.64 }],
    texts: [
      { name: 'Caption', text: 'Your caption here', style: 'bold', x: 0.07, y: 0.67, w: 0.86 },
    ],
  },
  {
    id: 'three-stack',
    name: 'Three stacked frames',
    description: 'Three pictures, one above the other: steps, a list, a sequence',
    aspects: ['vertical'],
    slots: [
      { name: 'Top', x: 0, y: 0, w: 1, h: 1 / 3 },
      { name: 'Middle', x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { name: 'Bottom', x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: 'talking-head-broll',
    name: 'Talking head + B-roll',
    description: 'The speaker fills the frame, B-roll shows in a card above',
    aspects: ['vertical'],
    slots: [
      { name: 'Talking head', x: 0, y: 0, w: 1, h: 1 },
      { name: 'B-roll', x: 0.06, y: 0.12, w: 0.88, h: 0.28 },
    ],
  },
  // landscape 16:9
  {
    id: 'full-frame',
    name: 'Full frame',
    description: 'One picture fills the frame',
    aspects: ['landscape', 'square', 'portrait'],
    slots: [full()],
  },
  {
    id: 'two-up',
    name: 'Two-up',
    description: 'Two pictures side by side',
    aspects: ['landscape', 'square'],
    slots: [
      { name: 'Left', x: 0, y: 0, w: 0.5, h: 1 },
      { name: 'Right', x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: 'lower-third',
    name: 'Lower third',
    description: 'A full-frame picture with a name and title bottom left',
    aspects: ['landscape'],
    slots: [full()],
    texts: [
      { name: 'Lower third', text: 'Name · Title', style: 'lower-third', x: 0.07, y: 0.74, w: 0.5 },
    ],
  },
  {
    id: 'title-card',
    name: 'Title card',
    description: 'A big title on a plain background',
    aspects: ['landscape', 'square', 'portrait'],
    background: '#101114',
    slots: [],
    texts: [{ name: 'Title', text: 'Title', style: 'title', x: 0.1, y: 0.42, w: 0.8 }],
  },
  // square 1:1 and portrait 4:5 (feeds)
  {
    id: 'stacked',
    name: 'Stacked',
    description: 'Two pictures, one above the other',
    aspects: ['portrait'],
    slots: [
      { name: 'Top', x: 0, y: 0, w: 1, h: 0.5 },
      { name: 'Bottom', x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: 'caption',
    name: 'Picture + caption',
    description: 'A full-frame picture with a bold caption at the bottom',
    aspects: ['square', 'portrait'],
    slots: [full()],
    texts: [
      { name: 'Caption', text: 'Your caption here', style: 'bold', x: 0.08, y: 0.76, w: 0.84 },
    ],
  },
];

/** Layouts that suit a frame of this size (the frame's aspect class). */
export function layoutsFor(width: number, height: number): LayoutDef[] {
  const c = aspectClass(width, height);
  return LAYOUTS.filter((l) => l.aspects.includes(c));
}

export function getLayout(id: string): LayoutDef {
  return (
    LAYOUTS.find((l) => l.id === id) ??
    fail(`Unknown layout "${id}" (use one of ${LAYOUTS.map((l) => l.id).join(', ')})`)
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'slot';

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Layers of a layout for a frame: slots (bottom first) and placeholder texts (on top). */
export function layoutLayers(
  layout: LayoutDef,
  frame: { width: number; height: number },
  taken = new Set<string>(),
): { slots: Layer[]; texts: Layer[] } {
  const { width: W, height: H } = frame;
  const slots = layout.slots.map((s): Layer => ({
    id: uniqueId(slug(s.name), taken),
    kind: 'slot',
    name: s.name,
    x: r2(s.x * W),
    y: r2(s.y * H),
    width: r2(s.w * W),
    height: r2(s.h * H),
  }));
  const texts = (layout.texts ?? []).map((t) => {
    const input = textLayerInput(
      {
        text: t.text,
        style: t.style,
        name: t.name,
        x: r2(t.x * W),
        y: r2(t.y * H),
        width: r2(t.w * W),
      },
      frame,
    );
    return { ...input, id: uniqueId(slug(t.name), taken) } as Layer;
  });
  return { slots, texts };
}

export interface ApplyLayoutOptions {
  /**
   * Canvas variant to re-arrange: its pictures go into the slots (largest first), its text stays.
   * An image variant becomes a new canvas variant with that image in the first slot. Omitted: a
   * new canvas variant.
   */
  variantId?: string;
  /** Pictures for the slots, in slot order (asset IDs). */
  images?: string[];
  /** Name of a new variant (default: the layout's name). */
  name?: string;
  /** Make a new variant the active one (default true). */
  activate?: boolean;
}

/**
 * Applies a layout to a shot. Returns the variant ID (new or re-arranged). On an existing canvas,
 * image layers are mapped into the slots by size (largest picture → first slot); pictures that
 * do not fit any slot and all text layers stay as they are; old empty slots are replaced; the
 * layout's placeholder texts are added only when the canvas has no text yet.
 */
export function applyLayout(
  p: SbdProject,
  shotId: string,
  layoutId: string,
  opts: ApplyLayoutOptions = {},
): { project: SbdProject; id: string } {
  const layout = getLayout(layoutId);
  const shot = p.shots[shotId] ?? fail(`Unknown shot "${shotId}"`);
  const existing = opts.variantId
    ? ((shot!.variants ?? []).find((v) => v.id === opts.variantId) ??
      fail(`Shot "${shotId}" has no variant "${opts.variantId}"`))
    : undefined;
  const assets = new Map(p.assets.assets.map((a) => [a.id, a]));
  const images = opts.images ?? [];
  for (const id of images) {
    const a = assets.get(id) ?? fail(`Unknown asset "${id}"`);
    if (a!.kind !== 'image' && a!.kind !== 'video')
      fail(`Asset "${id}" is ${a!.kind}; slots take images or videos`);
  }

  if (existing?.type === 'canvas') {
    const frame = canvasSizeOf(existing, p.manifest);
    const keepIds = new Set(existing.layers.map((l) => l.id));
    const { slots, texts } = layoutLayers(layout, frame, keepIds);
    const pictures = existing.layers.filter((l) => layerKind(l) === 'image' && l.asset);
    const area = (l: Layer) => {
      const a = l.asset ? assets.get(l.asset) : undefined;
      const w = (l.width ?? l.crop?.width ?? a?.width ?? 0) * Math.abs(l.scale_x ?? 1);
      const h = (l.height ?? l.crop?.height ?? a?.height ?? 0) * Math.abs(l.scale_y ?? 1);
      return w * h;
    };
    const queue = [
      ...images.map((id) => ({ asset: assets.get(id)!, from: null as Layer | null })),
      ...pictures
        .toSorted((a, b) => area(b) - area(a))
        .map((l) => ({ asset: assets.get(l.asset!)!, from: l })),
    ].filter((x) => x.asset);
    const used = new Set<string>();
    const filled = slots.map((s) => {
      const next = queue.shift();
      if (!next) return s;
      if (next.from) used.add(next.from.id);
      const base = next.from ? { ...next.from, id: next.from.id } : s;
      const l = filledLayer(base, slotFrameOf(s)!, next.asset, 'cover');
      l.slot!.name = s.name;
      if (next.from) return l;
      return { ...l, id: s.id };
    });
    // pictures left over (more pictures than slots) become free layers again
    const others = existing.layers
      .filter((l) => !used.has(l.id) && layerKind(l) !== 'slot')
      .map((l) => {
        if (!l.slot) return l;
        const { slot: _s, ...rest } = l;
        return rest as Layer;
      });
    const hasText = existing.layers.some((l) => layerKind(l) === 'text');
    const layers = [...filled, ...others, ...(hasText ? [] : texts)];
    const patch: Partial<CanvasVariant> = { layers };
    if (layout.background && !existing.background) patch.background = layout.background;
    return { project: updateVariant(p, shotId, existing.id, patch), id: existing.id };
  }

  const frame = canvasSizeOf({}, p.manifest);
  const { slots, texts } = layoutLayers(layout, frame);
  const queue = [...images];
  if (existing?.type === 'image') queue.unshift(existing.asset);
  const layers = [
    ...slots.map((s) => {
      const id = queue.shift();
      const a = id ? assets.get(id) : undefined;
      if (!a) return s;
      const l = filledLayer(s, slotFrameOf(s)!, a, 'cover');
      l.slot!.name = s.name;
      return l;
    }),
    ...texts,
  ];
  const variant = {
    type: 'canvas' as const,
    name:
      opts.name ??
      (existing?.type === 'image' ? `${existing.name ?? 'Image'} layout` : layout.name),
    layers,
    ...(layout.background ? { background: layout.background } : {}),
  };
  const taken = new Set((shot!.variants ?? []).map((v) => v.id));
  return addVariant(
    p,
    shotId,
    { ...variant, id: newId('v', taken) },
    { activate: opts.activate ?? true },
  );
}
