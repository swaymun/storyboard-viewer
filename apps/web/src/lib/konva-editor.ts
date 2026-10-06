/**
 * Konva editor for a canvas variant. Node attributes map 1:1 to SBD layer fields (x, y, width,
 * height, scaleX/Y, rotation, opacity, crop); filters use the same CSS filter string as the DOM
 * renderer (`cssFilter`, applied natively by Konva through `ctx.filter`), and text layers are
 * drawn by the shared routine in `text-render.ts`, so the Canvas tab, cards, the print view,
 * flattened previews and the video export match.
 *
 * View: the stage fills its container; the frame sits at `origin` with `zoom` (screen px per
 * canvas px). "Fit" keeps the whole frame in view as the container resizes; zooming, the wheel
 * and Space-drag pan. Layer positions are always in frame (canvas) coordinates.
 *
 * Interaction is handled here (not by Konva's own dragging) so several selected layers move as
 * one, snapping can show what it snapped to, Alt starts a duplicate and Cmd/Ctrl (or Alt) moves
 * freely. The caller owns the selection and applies every change as an undoable op, then calls
 * `update()` with the new state.
 */
import type Konva from 'konva';
import { layerKind, type Asset, type CanvasVariant, type Layer } from '@storyboard-viewer/format';
import { rectTargets, rotateAbout, snapRect, union, type Rect } from './arrange';
import { setMediaSource } from './hls';
import {
  PLATFORMS,
  SAFE_AREAS,
  guideTargets,
  placeZoneLabels,
  type Platform,
  type SnapLine,
} from './safe-zones';
import { drawText, loadTextFonts, measureText } from './text-render';
import { theme } from './theme.svelte';
import { cssFilter } from './visual';

export interface EditorInput {
  variant: CanvasVariant;
  size: { width: number; height: number };
  assets: Map<string, Asset>;
  url: (src: string) => string | null;
  /** Selected layer IDs. */
  selected: readonly string[];
  editable: boolean;
  /** Title / action safe areas. */
  guides: boolean;
  /** Platform UI areas shown (vertical frames). */
  platforms: readonly Platform[];
  snapping: boolean;
  /** A text layer being edited inline (hidden on the stage meanwhile). */
  editingText: string | null;
}

/** Node attributes after a resize/rotate (canvas px; width/height unscaled). */
export interface NodeAttrs {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface EditorCallbacks {
  /** Click on a layer (`toggle` with Shift/Cmd/Ctrl) or on the empty frame (`id` null). */
  onPick(id: string | null, mode: 'replace' | 'toggle'): void;
  /** Rubber-band selection on the empty frame (Shift adds). */
  onMarquee(ids: string[], additive: boolean): void;
  /** The selection was dragged by (dx, dy) canvas px; `duplicate` when the drag began with Alt. */
  onMove(ids: string[], dx: number, dy: number, duplicate: boolean): void;
  onTransform(attrs: Record<string, NodeAttrs>): void;
  /** Double-click on a text layer. */
  onEditText(id: string): void;
  /** Double-click on an empty slot. */
  onActivateSlot(id: string): void;
  /** Zoom / fit changed (for the zoom readout). */
  onView(view: { zoom: number; fit: boolean }): void;
  /** What a drag is snapped to right now ([] when free). */
  onSnap(labels: string[]): void;
}

export interface EditorHandle {
  resize(width: number, height: number): void;
  update(input: EditorInput): Promise<void>;
  /** Canvas coordinates of a client (screen) point. */
  toCanvasPoint(clientX: number, clientY: number): { x: number; y: number };
  /** Flattened frame (no guides, slots or selection) at canvas resolution. */
  toBlob(): Promise<Blob>;
  /** Re-reads the theme colors (handles, mask, guides). */
  refreshTheme(): void;
  /** `fit` = whole frame in view; a number = that zoom (1 = 100 %). */
  zoomTo(zoom: number | 'fit', at?: { x: number; y: number }): void;
  zoomBy(factor: number): void;
  /** Space held: dragging pans. */
  setPanKey(held: boolean): void;
  /** Bounding box of layers in canvas px (rotation included). */
  bounds(ids: readonly string[]): Rect | null;
  /** Each layer's box in canvas px. */
  boxes(ids: readonly string[]): Map<string, Rect>;
  /**
   * The selection turned by `deg` around the center of its bounding box (locked and hidden
   * layers stay), as transformer results: apply them like a rotation with the handle.
   */
  rotated(ids: readonly string[], deg: number): Record<string, NodeAttrs>;
  /** Where a layer sits in the container (px), for the inline text editor. */
  screenBox(id: string): { x: number; y: number; zoom: number; rotation: number } | null;
  readonly view: { zoom: number; x: number; y: number; fit: boolean };
  destroy(): void;
}

/** Transformer handles (screen px): the rotate handle sits ROTATE_OFFSET outside the box. */
const ANCHOR = 9;
const ROTATE_OFFSET = 30;
/**
 * Space around the frame at Fit: room for every handle of a full-frame selection (the rotate
 * handle and its anchor, plus a little air), so it can be grabbed without panning first.
 */
export const FIT_PAD = ROTATE_OFFSET + ANCHOR + 8;
const PAD = FIT_PAD;
const SNAP_PX = 7;
const DRAG_PX = 3;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const imageCache = new Map<string, Promise<CanvasImageSource | null>>();

function loadImage(url: string, kind: Asset['kind']): Promise<CanvasImageSource | null> {
  const key = `${kind}|${url}`;
  let p = imageCache.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      if (kind === 'video') {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.crossOrigin = 'anonymous';
        setMediaSource(v, url);
        v.addEventListener('loadeddata', () => resolve(v), { once: true });
        v.addEventListener('error', () => resolve(null), { once: true });
        return;
      }
      const img = new Image();
      if (/^https?:/.test(url) && !url.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imageCache.set(key, p);
  }
  return p;
}

const natural = (img: CanvasImageSource | null, a: Asset | undefined) => ({
  w:
    a?.width ??
    (img as HTMLImageElement | null)?.naturalWidth ??
    (img as HTMLVideoElement | null)?.videoWidth ??
    100,
  h:
    a?.height ??
    (img as HTMLImageElement | null)?.naturalHeight ??
    (img as HTMLVideoElement | null)?.videoHeight ??
    100,
});

export async function createEditor(
  container: HTMLDivElement,
  first: EditorInput,
  cb: EditorCallbacks,
): Promise<EditorHandle> {
  const K = (await import('konva')).default;
  let input = first;
  let box = { width: container.clientWidth || 640, height: container.clientHeight || 360 };
  const view = { zoom: 1, x: PAD, y: PAD, fit: true };
  let version = 0;
  let panKey = false;

  const stage = new K.Stage({ container, width: box.width, height: box.height });
  const content = new K.Layer();
  const overlay = new K.Layer();
  stage.add(content, overlay);
  const frame = new K.Group();
  content.add(frame);
  const bg = new K.Rect({ x: 0, y: 0, name: 'background' });
  frame.add(bg);
  /** Empty slots are drawn above the pictures but are not part of the frame (hidden in exports). */
  const slotLayer = new K.Group({ name: 'slots' });
  const mask = new K.Group({ listening: false });
  const guideGroup = new K.Group({ listening: false });
  const snapGroup = new K.Group({ listening: false });
  const marquee = new K.Rect({ visible: false, listening: false, strokeWidth: 1 });
  const transformer = new K.Transformer({
    rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
    rotationSnapTolerance: 4,
    anchorSize: ANCHOR,
    anchorCornerRadius: 2,
    rotateAnchorOffset: ROTATE_OFFSET,
    flipEnabled: true,
    ignoreStroke: true,
  });
  overlay.add(mask, slotLayer, guideGroup, snapGroup, transformer, marquee);
  const nodes = new Map<string, Konva.Node>();
  const kinds = new Map<string, string>();

  const colors = () => ({
    handle: theme.token('--canvas-handle', 'orange'),
    handleFill: theme.token('--canvas-handle-fill', 'white'),
    guide: theme.token('--canvas-guide', 'skyblue'),
    snap: theme.token('--canvas-snap', 'magenta'),
    label: theme.token('--canvas-label-fg', 'white'),
    platform: Object.fromEntries(
      PLATFORMS.map((p) => [
        p.id,
        {
          line: theme.token(`--canvas-platform-${p.id}`, 'red'),
          fill: theme.token(`--canvas-platform-${p.id}-fill`, 'rgba(255,0,0,0.12)'),
        },
      ]),
    ) as Record<Platform, { line: string; fill: string }>,
    slot: theme.token('--canvas-slot', 'rgba(128,128,128,0.3)'),
    slotFg: theme.token('--canvas-slot-fg', 'white'),
    mask: theme.token('--canvas-mask', 'black'),
    frame: theme.token('--canvas-frame', 'white'),
  });
  let c = colors();
  const applyTransformerColors = () => {
    transformer.borderStroke(c.handle);
    transformer.anchorStroke(c.handle);
    transformer.anchorFill(c.handleFill);
    marquee.stroke(c.handle);
    marquee.fill(c.slot);
  };
  applyTransformerColors();

  // --- view

  const fitZoom = () => {
    const { width, height } = input.size;
    return Math.max(0.01, Math.min((box.width - 2 * PAD) / width, (box.height - 2 * PAD) / height));
  };

  const applyView = () => {
    if (view.fit) {
      view.zoom = fitZoom();
      view.x = (box.width - input.size.width * view.zoom) / 2;
      view.y = (box.height - input.size.height * view.zoom) / 2;
    }
    stage.size(box);
    for (const l of [content, overlay]) {
      l.scale({ x: view.zoom, y: view.zoom });
      l.position({ x: view.x, y: view.y });
    }
    container.dataset['zoom'] = String(view.zoom);
    container.dataset['originX'] = String(view.x);
    container.dataset['originY'] = String(view.y);
    drawMask();
    drawGuides();
    drawSlots();
    transformer.forceUpdate();
    placeRotater();
    stage.batchDraw();
    cb.onView({ zoom: view.zoom, fit: view.fit });
  };

  const zoomTo = (z: number | 'fit', at?: { x: number; y: number }) => {
    if (z === 'fit') {
      view.fit = true;
      applyView();
      return;
    }
    const next = Math.max(0.05, Math.min(8, z));
    const p = at ?? { x: box.width / 2, y: box.height / 2 };
    const fx = (p.x - view.x) / view.zoom;
    const fy = (p.y - view.y) / view.zoom;
    view.fit = false;
    view.zoom = next;
    view.x = p.x - fx * next;
    view.y = p.y - fy * next;
    applyView();
  };

  // --- drawing helpers (overlay, in canvas px)

  const drawMask = () => {
    mask.destroyChildren();
    const { width: W, height: H } = input.size;
    const far = 100000;
    const fill = c.mask;
    mask.add(
      // one shape with a hole (even-odd), not four rectangles: abutting translucent rectangles
      // show seams along the frame's edges at fractional zooms
      new K.Shape({
        sceneFunc: (ctx) => {
          const g = ctx._context;
          g.beginPath();
          g.rect(-far, -far, 2 * far, 2 * far);
          g.rect(0, 0, W, H);
          g.fillStyle = fill;
          g.fill('evenodd');
        },
      }),
      new K.Rect({
        x: 0,
        y: 0,
        width: W,
        height: H,
        stroke: c.frame,
        strokeWidth: 1 / view.zoom,
      }),
    );
  };

  const smallText = (px: number) => px / view.zoom;

  const drawGuides = () => {
    guideGroup.destroyChildren();
    const { width: W, height: H } = input.size;
    const sw = 1 / view.zoom;
    // zones first (each platform in its own color), then their labels as small tags in the
    // platform's color, placed so that they never cover one another
    const requests: Array<{ label: Konva.Label; vertical: boolean; zone: Rect }> = [];
    for (const p of PLATFORMS) {
      if (!input.platforms.includes(p.id)) continue;
      const pc = c.platform[p.id];
      for (const z of p.zones) {
        const r = { x: z.x * W, y: z.y * H, width: z.w * W, height: z.h * H };
        guideGroup.add(
          new K.Rect({
            ...r,
            name: `zone zone-${p.id}`,
            fill: pc.fill,
            stroke: pc.line,
            strokeWidth: 1.5 * sw,
            dash: [5 * sw, 3 * sw],
          }),
        );
        const label = new K.Label({ name: `zone-label zone-label-${p.id}` });
        label.add(
          new K.Tag({ fill: pc.line, cornerRadius: 3 * sw }),
          new K.Text({
            text: z.label,
            fontSize: smallText(11),
            fontFamily: 'IBM Plex Sans, sans-serif',
            padding: 3 * sw,
            fill: c.label,
          }),
        );
        requests.push({ label, vertical: r.width * view.zoom < 90, zone: r });
      }
    }
    const boxes = placeZoneLabels(
      requests.map((q) => ({
        zone: q.zone,
        width: q.label.width(),
        height: q.label.height(),
        vertical: q.vertical,
      })),
      3 * sw,
    );
    requests.forEach((q, i) => {
      const b = boxes[i]!;
      // turned 90° clockwise about its origin, a label extends to the left of it
      q.label.setAttrs(
        q.vertical ? { x: b.x + b.width, y: b.y, rotation: 90 } : { x: b.x, y: b.y, rotation: 0 },
      );
      guideGroup.add(q.label);
    });
    if (!input.guides) return;
    const dash = [6 * sw, 4 * sw];
    for (const s of SAFE_AREAS) {
      guideGroup.add(
        new K.Rect({
          x: W * s.inset,
          y: H * s.inset,
          width: W * (1 - 2 * s.inset),
          height: H * (1 - 2 * s.inset),
          stroke: c.guide,
          strokeWidth: sw,
          dash,
        }),
      );
    }
    const k = Math.min(W, H) * 0.03;
    guideGroup.add(
      new K.Line({
        points: [W / 2 - k, H / 2, W / 2 + k, H / 2],
        stroke: c.guide,
        strokeWidth: sw,
      }),
      new K.Line({
        points: [W / 2, H / 2 - k, W / 2, H / 2 + k],
        stroke: c.guide,
        strokeWidth: sw,
      }),
    );
  };

  /** Empty slots: dashed, labeled placeholders (editor only). */
  const drawSlots = () => {
    for (const l of input.variant.layers) {
      if (layerKind(l) !== 'slot') continue;
      const g = nodes.get(l.id) as Konva.Group | undefined;
      if (!g) continue;
      const w = l.width ?? 100;
      const h = l.height ?? 100;
      const sw = 1 / view.zoom;
      const rect = g.findOne('.slot-rect') as Konva.Rect;
      rect.setAttrs({
        width: w,
        height: h,
        fill: c.slot,
        stroke: c.slotFg,
        strokeWidth: sw,
        dash: [8 * sw, 5 * sw],
      });
      const size = Math.max(smallText(11), Math.min(w, h) * 0.07);
      const label = g.findOne('.slot-label') as Konva.Text;
      label.setAttrs({
        width: w,
        y: h / 2 - size * 1.2,
        fontSize: size,
        fill: c.slotFg,
        text: `${l.name ?? 'Slot'}\nDrop an image`,
      });
    }
  };

  /**
   * Keeps the rotate handle on the stage: it sits above the selection, or below / beside it
   * when there is no room above (e.g. a full-frame selection after zooming in).
   */
  const placeRotater = () => {
    if (!transformer.nodes().length || !transformer.rotateEnabled() || transformer.isTransforming())
      return;
    const rotater = transformer.findOne('.rotater');
    if (!rotater) return;
    const fits = () => {
      const r = rotater.getClientRect();
      return r.x >= 0 && r.y >= 0 && r.x + r.width <= box.width && r.y + r.height <= box.height;
    };
    for (const angle of [0, 180, 90, 270]) {
      transformer.rotateAnchorAngle(angle);
      transformer.forceUpdate();
      if (fits()) return;
    }
    transformer.rotateAnchorAngle(0);
    transformer.forceUpdate();
  };

  const layerById = (id: string) => input.variant.layers.find((l) => l.id === id);
  const isLocked = (id: string) => layerById(id)?.locked === true;

  const attach = () => {
    const ids = input.editable ? input.selected : [];
    const list = ids.map((id) => nodes.get(id)).filter((n): n is Konva.Node => !!n && n.visible());
    transformer.nodes(list);
    const locked = ids.length > 0 && ids.every(isLocked);
    const onlyText = list.length > 0 && ids.every((id) => kinds.get(id) === 'text');
    const anySlotted = ids.some((id) => {
      const l = layerById(id);
      return l && (layerKind(l) === 'slot' || l.slot);
    });
    transformer.resizeEnabled(!locked);
    transformer.rotateEnabled(!locked);
    transformer.borderDash(locked ? [4, 4] : []);
    // text: corners scale the type, sides change the wrap width; slots and pictures in slots
    // resize their frame freely
    transformer.keepRatio(!anySlotted);
    transformer.enabledAnchors(
      onlyText && list.length === 1
        ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
        : [
            'top-left',
            'top-center',
            'top-right',
            'middle-left',
            'middle-right',
            'bottom-left',
            'bottom-center',
            'bottom-right',
          ],
    );
    placeRotater();
    overlay.batchDraw();
  };

  // --- nodes

  const attrsOf = (n: Konva.Node, at?: { x: number; y: number; rotation: number }): NodeAttrs => ({
    x: round(at?.x ?? n.x()),
    y: round(at?.y ?? n.y()),
    width: round(n.width()),
    height: round(n.height()),
    scaleX: round(n.scaleX(), 4),
    scaleY: round(n.scaleY(), 4),
    rotation: round(at?.rotation ?? n.rotation()),
  });

  const makeNode = (l: Layer): Konva.Node => {
    const kind = layerKind(l);
    let node: Konva.Node;
    if (kind === 'text') {
      const shape: Konva.Shape = new K.Shape({
        id: l.id,
        name: 'layer',
        sceneFunc: (ctx, s) => {
          const data = s.getAttr('layerData') as Layer;
          drawText(ctx._context, data, s.getAttr('metrics'));
        },
        hitFunc: (ctx, s) => {
          ctx.beginPath();
          ctx.rect(0, 0, s.width(), s.height());
          ctx.closePath();
          ctx.fillStrokeShape(s);
        },
      });
      shape.on('transform', () => {
        // side handles change the wrap width (the text reflows); corners scale the type
        const anchor = transformer.getActiveAnchor();
        if (anchor === 'middle-left' || anchor === 'middle-right') {
          const w = Math.max(20, shape.width() * shape.scaleX());
          const data = { ...(shape.getAttr('layerData') as Layer), width: w };
          const m = measureText(data);
          shape.setAttrs({ width: w, height: m.height, scaleX: 1, layerData: data, metrics: m });
        }
      });
      node = shape;
    } else if (kind === 'slot') {
      const g = new K.Group({ id: l.id, name: 'layer' });
      g.add(
        new K.Rect({ name: 'slot-rect' }),
        new K.Text({
          name: 'slot-label',
          align: 'center',
          fontFamily: 'IBM Plex Sans, sans-serif',
          lineHeight: 1.3,
          listening: false,
        }),
      );
      node = g;
    } else {
      node = new K.Image({ id: l.id, name: 'layer', image: undefined });
    }
    node.on('dblclick dbltap', () => {
      if (!input.editable) return;
      const k = kinds.get(l.id);
      if (k === 'text' && !isLocked(l.id)) cb.onEditText(l.id);
      else if (k === 'slot' || layerById(l.id)?.slot) cb.onActivateSlot(l.id);
    });
    node.on('transformend', () => {
      const out: Record<string, NodeAttrs> = {};
      for (const n of transformer.nodes()) out[n.id()] = attrsOf(n);
      // only once per gesture (every attached node fires transformend)
      if (transformer.nodes()[0] === node) {
        cb.onTransform(out);
        placeRotater();
      }
    });
    return node;
  };

  const sync = async () => {
    const my = ++version;
    const { variant, size, assets, url } = input;
    bg.size(size);
    bg.fill(variant.background ?? 'transparent');
    const loaded = await Promise.all(
      variant.layers.map(async (l) => {
        if (layerKind(l) !== 'image') return { l, a: undefined, img: null };
        const a = l.asset ? assets.get(l.asset) : undefined;
        const u = a ? url(a.src) : null;
        return { l, a, img: a && u ? await loadImage(u, a.kind) : null };
      }),
    );
    if (my !== version) return;
    const live = new Set(variant.layers.map((l) => l.id));
    for (const [id, n] of nodes)
      if (!live.has(id) || kinds.get(id) !== layerKind(layerById(id)!)) {
        n.destroy();
        nodes.delete(id);
        kinds.delete(id);
      }
    let z = 0;
    for (const { l, a, img } of loaded) {
      const kind = layerKind(l);
      let node = nodes.get(l.id);
      if (!node) {
        node = makeNode(l);
        nodes.set(l.id, node);
        kinds.set(l.id, kind);
        (kind === 'slot' ? slotLayer : frame).add(node as Konva.Shape);
      }
      const common = {
        x: l.x ?? 0,
        y: l.y ?? 0,
        scaleX: l.scale_x ?? 1,
        scaleY: l.scale_y ?? 1,
        rotation: l.rotation ?? 0,
        opacity: l.opacity ?? 1,
        draggable: false,
      };
      if (kind === 'text') {
        const m = measureText(l);
        node.setAttrs({
          ...common,
          width: m.width,
          height: m.height,
          layerData: l,
          metrics: m,
          visible: l.visible !== false && input.editingText !== l.id,
        });
      } else if (kind === 'slot') {
        node.setAttrs({
          ...common,
          width: l.width ?? 100,
          height: l.height ?? 100,
          visible: l.visible !== false,
        });
      } else if (kind === 'image') {
        const nat = natural(img, a);
        const im = node as Konva.Image;
        im.setAttrs({
          ...common,
          image: img ?? undefined,
          name: 'layer',
          width: l.width ?? l.crop?.width ?? nat.w,
          height: l.height ?? l.crop?.height ?? nat.h,
          visible: l.visible !== false && !!img,
        });
        if (l.crop) im.crop(l.crop);
        else im.crop({ x: 0, y: 0, width: 0, height: 0 });
        const css = cssFilter(l.filters);
        im.clearCache();
        if (css !== 'none' && img) {
          im.filters([css as never]);
          try {
            im.cache();
          } catch {
            im.filters([]);
          }
        } else im.filters([]);
      } else {
        node.visible(false); // unknown kind: ignored
      }
      if (kind !== 'slot') node.zIndex(++z);
    }
    drawSlots();
    applyView();
    attach();
    content.batchDraw();
    // fonts arrive later: measure and draw again
    const texts = variant.layers.filter((l) => layerKind(l) === 'text');
    if (texts.length)
      void loadTextFonts(texts, assets, url).then(() => {
        if (my !== version) return;
        for (const l of texts) {
          const n = nodes.get(l.id);
          if (!n) continue;
          const m = measureText(l);
          n.setAttrs({ width: m.width, height: m.height, metrics: m });
        }
        transformer.forceUpdate();
        stage.batchDraw();
      });
  };

  // --- geometry

  const rectOf = (id: string): Rect | null => {
    const n = nodes.get(id);
    if (!n || !n.visible()) return null;
    const r = n.getClientRect({ relativeTo: frame as unknown as Konva.Container });
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  const label = (l: Layer) =>
    layerKind(l) === 'slot'
      ? `Slot: ${l.name ?? 'slot'}`
      : l.slot?.name
        ? `Slot: ${l.slot.name}`
        : `Layer: ${l.name ?? (layerKind(l) === 'text' ? (l.text ?? '').slice(0, 24) : (input.assets.get(l.asset ?? '')?.name ?? l.id))}`;

  const snapTargets = (moving: Set<string>) => {
    const t = guideTargets(input.size, input.guides, input.platforms);
    const others = input.variant.layers
      .filter((l) => !moving.has(l.id))
      .map((l) => ({ rect: rectOf(l.id), label: label(l) }))
      .filter((o): o is { rect: Rect; label: string } => !!o.rect);
    // slot frames of pictures stay targets while the picture moves elsewhere
    const r = rectTargets(others);
    return { x: [...t.x, ...r.x], y: [...t.y, ...r.y] };
  };

  const showSnap = (lines: { x: SnapLine | null; y: SnapLine | null }, r: Rect) => {
    snapGroup.destroyChildren();
    const { width: W, height: H } = input.size;
    const sw = 1 / view.zoom;
    const tag = (text: string, x: number, y: number) => {
      const lbl = new K.Label({ x, y });
      lbl.add(
        new K.Tag({ fill: c.snap, cornerRadius: 3 * sw }),
        new K.Text({
          text,
          fontSize: smallText(11),
          fontFamily: 'IBM Plex Sans, sans-serif',
          padding: 3 * sw,
          fill: c.label,
        }),
      );
      snapGroup.add(lbl);
    };
    const far = Math.max(W, H);
    if (lines.x) {
      snapGroup.add(
        new K.Line({
          points: [lines.x.at, -far, lines.x.at, H + far],
          stroke: c.snap,
          strokeWidth: sw,
        }),
      );
      tag(lines.x.label, lines.x.at + 4 * sw, r.y - 22 * sw);
    }
    if (lines.y) {
      snapGroup.add(
        new K.Line({
          points: [-far, lines.y.at, W + far, lines.y.at],
          stroke: c.snap,
          strokeWidth: sw,
        }),
      );
      tag(lines.y.label, r.x + r.width + 6 * sw, lines.y.at + 3 * sw);
    }
    cb.onSnap([...new Set([lines.x?.label, lines.y?.label].filter((s): s is string => !!s))]);
  };

  // --- pointer interaction

  interface Drag {
    kind: 'move' | 'marquee' | 'pan';
    startX: number;
    startY: number;
    moved: boolean;
    ids: string[];
    starts: Map<string, { x: number; y: number }>;
    box: Rect | null;
    duplicate: boolean;
    additive: boolean;
    view: { x: number; y: number };
    targets: { x: SnapLine[]; y: SnapLine[] } | null;
    dx: number;
    dy: number;
    /** A locked layer under the press (selected on a click). */
    lockedHit?: string;
    /** Cmd/Ctrl-press: toggled in the selection when released without moving. */
    toggle?: string;
  }
  let drag: Drag | null = null;

  const layerIdOf = (target: Konva.Node): string | null => {
    let n: Konva.Node | null = target;
    while (n && n !== stage) {
      if (n.hasName('layer')) return n.id();
      n = n.getParent();
    }
    return null;
  };
  const isTransformerPart = (target: Konva.Node) => {
    let n: Konva.Node | null = target;
    while (n) {
      if (n === transformer) return true;
      n = n.getParent();
    }
    return false;
  };

  /** The layers a press on `id` moves: the selection when it is part of it, else its group. */
  const moveSet = (id: string): string[] => {
    if (input.selected.includes(id)) return [...input.selected];
    const g = layerById(id)?.group;
    return g ? input.variant.layers.filter((l) => l.group === g).map((l) => l.id) : [id];
  };

  const pointer = (e: PointerEvent | MouseEvent) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  stage.on('pointerdown', (ke) => {
    const e = ke.evt as PointerEvent;
    if (e.button === 2) return;
    container.focus({ preventScroll: true });
    const p = pointer(e);
    const base: Drag = {
      kind: 'pan',
      startX: p.x,
      startY: p.y,
      moved: false,
      ids: [],
      starts: new Map(),
      box: null,
      duplicate: false,
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
      view: { x: view.x, y: view.y },
      targets: null,
      dx: 0,
      dy: 0,
    };
    if (panKey || e.button === 1) {
      drag = base;
      container.style.cursor = 'grabbing';
      return;
    }
    if (isTransformerPart(ke.target)) return; // resize / rotate handles
    const hitId = layerIdOf(ke.target);
    // a locked layer (e.g. a background) does not grab the pointer: a drag on it draws a
    // selection box, a click selects it
    const id = hitId && isLocked(hitId) ? null : hitId;
    if (!id) {
      if (hitId) base.lockedHit = hitId;
      if (!input.editable && !base.additive) {
        cb.onPick(null, 'replace');
        return;
      }
      drag = { ...base, kind: 'marquee' };
      return;
    }
    if (e.shiftKey) {
      cb.onPick(id, 'toggle');
      return;
    }
    // Cmd/Ctrl: a click toggles the layer in the selection, a drag moves without snapping
    const mod = e.metaKey || e.ctrlKey;
    if (!mod && !input.selected.includes(id)) cb.onPick(id, 'replace');
    if (!input.editable) {
      if (mod) cb.onPick(id, 'toggle');
      return;
    }
    const ids = moveSet(id).filter((x) => !isLocked(x));
    if (!ids.length) {
      if (mod) cb.onPick(id, 'toggle');
      return;
    }
    const starts = new Map(
      ids.map((x) => [x, { x: nodes.get(x)!.x(), y: nodes.get(x)!.y() }] as const),
    );
    const rects = ids.map(rectOf).filter((r): r is Rect => !!r);
    drag = {
      ...base,
      kind: 'move',
      ids,
      starts,
      box: rects.length ? union(rects) : null,
      duplicate: e.altKey,
      ...(mod ? { toggle: id } : {}),
    };
  });

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = pointer(e);
    const sx = p.x - drag.startX;
    const sy = p.y - drag.startY;
    if (!drag.moved && Math.hypot(sx, sy) < DRAG_PX) return;
    drag.moved = true;
    if (drag.kind === 'pan') {
      view.fit = false;
      view.x = drag.view.x + sx;
      view.y = drag.view.y + sy;
      applyView();
      return;
    }
    if (drag.kind === 'marquee') {
      const a = { x: (drag.startX - view.x) / view.zoom, y: (drag.startY - view.y) / view.zoom };
      const b = { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
      marquee.setAttrs({
        visible: true,
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
        strokeWidth: 1 / view.zoom,
        dash: [4 / view.zoom, 3 / view.zoom],
      });
      overlay.batchDraw();
      return;
    }
    let dx = sx / view.zoom;
    let dy = sy / view.zoom;
    // Cmd/Ctrl (or Alt, after the start of an Alt-duplicate) moves freely
    const free = e.metaKey || e.ctrlKey || (e.altKey && !drag.duplicate);
    if (input.snapping && !free && drag.box) {
      drag.targets ??= snapTargets(new Set(drag.ids));
      const moved = { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
      const s = snapRect(moved, drag.targets, SNAP_PX / view.zoom);
      dx += s.dx;
      dy += s.dy;
      showSnap(s, { ...moved, x: moved.x + s.dx, y: moved.y + s.dy });
    } else if (snapGroup.hasChildren()) {
      snapGroup.destroyChildren();
      cb.onSnap([]);
    }
    drag.dx = dx;
    drag.dy = dy;
    for (const [id, s] of drag.starts) nodes.get(id)?.position({ x: s.x + dx, y: s.y + dy });
    transformer.forceUpdate();
    placeRotater();
    stage.batchDraw();
  };

  const onUp = (e: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === 'pan') {
      container.style.cursor = panKey ? 'grab' : '';
      return;
    }
    if (d.kind === 'marquee') {
      marquee.visible(false);
      overlay.batchDraw();
      if (!d.moved) {
        if (d.lockedHit) cb.onPick(d.lockedHit, d.additive ? 'toggle' : 'replace');
        else if (!d.additive) cb.onPick(null, 'replace');
        return;
      }
      const sel = {
        x: marquee.x(),
        y: marquee.y(),
        width: marquee.width(),
        height: marquee.height(),
      };
      const hit = input.variant.layers
        .filter((l) => !l.locked)
        .filter((l) => {
          const r = rectOf(l.id);
          return (
            !!r &&
            r.x < sel.x + sel.width &&
            r.x + r.width > sel.x &&
            r.y < sel.y + sel.height &&
            r.y + r.height > sel.y
          );
        })
        .map((l) => l.id);
      cb.onMarquee(hit, d.additive || e.shiftKey);
      return;
    }
    snapGroup.destroyChildren();
    overlay.batchDraw();
    cb.onSnap([]);
    if (!d.moved) {
      if (d.toggle) cb.onPick(d.toggle, 'toggle');
      return;
    }
    if (Math.abs(d.dx) < 0.005 && Math.abs(d.dy) < 0.005) return;
    cb.onMove(d.ids, round(d.dx), round(d.dy), d.duplicate);
  };

  const onWindowMove = (e: PointerEvent) => onMove(e);
  const onWindowUp = (e: PointerEvent) => onUp(e);
  window.addEventListener('pointermove', onWindowMove);
  window.addEventListener('pointerup', onWindowUp);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomTo(view.zoom * Math.exp(-e.deltaY * 0.01), pointer(e));
    } else {
      view.fit = false;
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      applyView();
    }
  };
  container.addEventListener('wheel', onWheel, { passive: false });

  stage.on('mousemove', (ke) => {
    if (drag || panKey) return;
    const id = layerIdOf(ke.target);
    container.style.cursor = id && input.editable && !isLocked(id) ? 'move' : '';
  });

  await sync();

  return {
    resize(width, height) {
      box = { width: Math.max(10, width), height: Math.max(10, height) };
      applyView();
    },
    async update(next) {
      const sizeChanged =
        next.size.width !== input.size.width || next.size.height !== input.size.height;
      const variantChanged = next.variant.id !== input.variant.id;
      input = next;
      if (sizeChanged || variantChanged) view.fit = true;
      await sync();
    },
    toCanvasPoint(clientX, clientY) {
      const r = container.getBoundingClientRect();
      return {
        x: (clientX - r.left - view.x) / view.zoom,
        y: (clientY - r.top - view.y) / view.zoom,
      };
    },
    async toBlob() {
      const { width, height } = input.size;
      const saved = { ...view, box: { ...box } };
      overlay.visible(false);
      try {
        view.fit = false;
        view.zoom = 1;
        view.x = 0;
        view.y = 0;
        box = { width, height };
        applyView();
        return (await stage.toBlob({
          x: 0,
          y: 0,
          width,
          height,
          pixelRatio: 1,
          mimeType: 'image/png',
        })) as Blob;
      } finally {
        overlay.visible(true);
        box = saved.box;
        view.zoom = saved.zoom;
        view.x = saved.x;
        view.y = saved.y;
        view.fit = saved.fit;
        applyView();
      }
    },
    refreshTheme() {
      c = colors();
      applyTransformerColors();
      drawMask();
      drawGuides();
      drawSlots();
      stage.batchDraw();
    },
    zoomTo,
    zoomBy(f) {
      zoomTo(view.zoom * f);
    },
    setPanKey(held) {
      panKey = held;
      if (!drag) container.style.cursor = held ? 'grab' : '';
    },
    bounds(ids) {
      const rects = ids.map(rectOf).filter((r): r is Rect => !!r);
      return rects.length ? union(rects) : null;
    },
    boxes(ids) {
      const out = new Map<string, Rect>();
      for (const id of ids) {
        const r = rectOf(id);
        if (r) out.set(id, r);
      }
      return out;
    },
    rotated(ids, deg) {
      const live = ids.filter((id) => !isLocked(id) && nodes.get(id)?.visible());
      const rects = live.map(rectOf).filter((r): r is Rect => !!r);
      if (!rects.length) return {};
      const u = union(rects);
      const pivot = { x: u.x + u.width / 2, y: u.y + u.height / 2 };
      const out: Record<string, NodeAttrs> = {};
      for (const id of live) {
        const n = nodes.get(id)!;
        out[id] = attrsOf(n, rotateAbout({ x: n.x(), y: n.y() }, n.rotation(), pivot, deg));
      }
      return out;
    },
    screenBox(id) {
      const n = nodes.get(id);
      if (!n) return null;
      return {
        x: view.x + n.x() * view.zoom,
        y: view.y + n.y() * view.zoom,
        zoom: view.zoom * Math.abs(n.scaleX()),
        rotation: n.rotation(),
      };
    },
    get view() {
      return { ...view };
    },
    destroy() {
      version++;
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      container.removeEventListener('wheel', onWheel);
      stage.destroy();
    },
  };
}
