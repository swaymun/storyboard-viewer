/**
 * Konva editor for a canvas variant. Node attributes map 1:1 to SBD layer fields (x, y,
 * width, height, scaleX/Y, rotation, opacity, crop); filters use the same CSS filter string as
 * the DOM renderer (`cssFilter`, applied natively by Konva through `ctx.filter`), so the Canvas
 * tab, cards and flattened previews match.
 *
 * The stage shows the frame plus a margin (dimmed) so layers can be dragged partly outside.
 * Edits are reported through callbacks on drag/transform end; the caller applies them as undoable
 * ops and calls `update()` with the new variant.
 */
import type Konva from 'konva';
import { setMediaSource } from './hls';
import type { Asset, CanvasVariant, Layer } from '@storyboard-viewer/format';
import { theme } from './theme.svelte';
import { cssFilter } from './visual';

export interface EditorInput {
  variant: CanvasVariant;
  size: { width: number; height: number };
  assets: Map<string, Asset>;
  url: (src: string) => string | null;
  selectedLayer: string | null;
  editable: boolean;
  /** Safe-area and center guides. */
  guides: boolean;
  snapping: boolean;
}

export interface EditorCallbacks {
  onSelect(id: string | null): void;
  onCommit(id: string, patch: Partial<Layer>, label: string): void;
}

export interface EditorHandle {
  resize(width: number, height: number): void;
  update(input: EditorInput): Promise<void>;
  /** Canvas coordinates of a client (screen) point. */
  toCanvasPoint(clientX: number, clientY: number): { x: number; y: number };
  /** Flattened frame (no guides or selection) at canvas resolution. */
  toBlob(): Promise<Blob>;
  /** Re-reads the theme colors (handles, mask, guides). */
  refreshTheme(): void;
  destroy(): void;
}

const PAD = 36;
const SNAP_PX = 7;
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
  let scale = 1;
  let version = 0;

  const stage = new K.Stage({ container, width: 10, height: 10 });
  const content = new K.Layer();
  const overlay = new K.Layer();
  stage.add(content, overlay);
  const frame = new K.Group();
  content.add(frame);
  const bg = new K.Rect({ x: 0, y: 0, name: 'background' });
  frame.add(bg);
  const mask = new K.Group({ listening: false });
  const guideGroup = new K.Group({ listening: false });
  const snapGroup = new K.Group({ listening: false });
  const transformer = new K.Transformer({
    rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
    rotationSnapTolerance: 4,
    anchorSize: 9,
    anchorCornerRadius: 2,
    borderStroke: theme.token('--canvas-handle', 'orange'),
    anchorStroke: theme.token('--canvas-handle', 'orange'),
    anchorFill: theme.token('--canvas-handle-fill', 'white'),
    flipEnabled: true,
    ignoreStroke: true,
  });
  overlay.add(mask, guideGroup, snapGroup, transformer);
  const nodes = new Map<string, Konva.Image>();

  const layout = () => {
    const { width, height } = input.size;
    scale = Math.max(
      0.01,
      Math.min((box.width - 2 * PAD) / width, (box.height - 2 * PAD) / height),
    );
    stage.width(Math.round(width * scale + 2 * PAD));
    stage.height(Math.round(height * scale + 2 * PAD));
    for (const l of [content, overlay]) {
      l.scale({ x: scale, y: scale });
      l.position({ x: PAD, y: PAD });
    }
    drawMask();
    drawGuides();
    transformer.forceUpdate();
  };

  const drawMask = () => {
    mask.destroyChildren();
    const { width: W, height: H } = input.size;
    const p = PAD / scale;
    const fill = theme.token('--canvas-mask', 'black');
    mask.add(
      new K.Rect({ x: -p, y: -p, width: W + 2 * p, height: p, fill }),
      new K.Rect({ x: -p, y: H, width: W + 2 * p, height: p, fill }),
      new K.Rect({ x: -p, y: 0, width: p, height: H, fill }),
      new K.Rect({ x: W, y: 0, width: p, height: H, fill }),
      new K.Rect({
        x: 0,
        y: 0,
        width: W,
        height: H,
        stroke: theme.token('--canvas-frame', 'white'),
        strokeWidth: 1 / scale,
      }),
    );
  };

  const drawGuides = () => {
    guideGroup.destroyChildren();
    if (!input.guides) return;
    const { width: W, height: H } = input.size;
    const sw = 1 / scale;
    const dash = [6 / scale, 4 / scale];
    const stroke = theme.token('--canvas-guide', 'skyblue');
    for (const inset of [0.05, 0.1]) {
      guideGroup.add(
        new K.Rect({
          x: W * inset,
          y: H * inset,
          width: W * (1 - 2 * inset),
          height: H * (1 - 2 * inset),
          stroke,
          strokeWidth: sw,
          dash,
        }),
      );
    }
    const c = Math.min(W, H) * 0.03;
    guideGroup.add(
      new K.Line({ points: [W / 2 - c, H / 2, W / 2 + c, H / 2], stroke, strokeWidth: sw }),
      new K.Line({ points: [W / 2, H / 2 - c, W / 2, H / 2 + c], stroke, strokeWidth: sw }),
    );
  };

  const layerById = (id: string) => input.variant.layers.find((l) => l.id === id);

  const attach = () => {
    const id = input.selectedLayer;
    const node = id ? nodes.get(id) : undefined;
    const layer = id ? layerById(id) : undefined;
    if (node && layer && node.visible() && input.editable) {
      const locked = layer.locked === true;
      transformer.nodes([node]);
      transformer.resizeEnabled(!locked);
      transformer.rotateEnabled(!locked);
      transformer.borderDash(locked ? [4, 4] : []);
    } else transformer.nodes([]);
    overlay.batchDraw();
  };

  // --- snapping
  const snap = (node: Konva.Image) => {
    snapGroup.destroyChildren();
    if (!input.snapping) return;
    const { width: W, height: H } = input.size;
    const r = node.getClientRect({ relativeTo: frame as unknown as Konva.Container });
    const tol = SNAP_PX / scale;
    const best = (edges: number[], targets: number[]) => {
      let d = Infinity;
      let at: number | null = null;
      for (const e of edges)
        for (const t of targets)
          if (Math.abs(t - e) < tol && Math.abs(t - e) < Math.abs(d)) {
            d = t - e;
            at = t;
          }
      return { d: Number.isFinite(d) ? d : 0, at };
    };
    const others = input.variant.layers
      .filter((l) => l.id !== node.id() && nodes.get(l.id)?.visible())
      .map((l) =>
        nodes.get(l.id)!.getClientRect({ relativeTo: frame as unknown as Konva.Container }),
      );
    const xt = [0, W / 2, W, ...others.flatMap((o) => [o.x, o.x + o.width / 2, o.x + o.width])];
    const yt = [0, H / 2, H, ...others.flatMap((o) => [o.y, o.y + o.height / 2, o.y + o.height])];
    const sx = best([r.x, r.x + r.width / 2, r.x + r.width], xt);
    const sy = best([r.y, r.y + r.height / 2, r.y + r.height], yt);
    node.x(node.x() + sx.d);
    node.y(node.y() + sy.d);
    const stroke = theme.token('--canvas-snap', 'magenta');
    const sw = 1 / scale;
    if (sx.at !== null)
      snapGroup.add(new K.Line({ points: [sx.at, -PAD, sx.at, H + PAD], stroke, strokeWidth: sw }));
    if (sy.at !== null)
      snapGroup.add(new K.Line({ points: [-PAD, sy.at, W + PAD, sy.at], stroke, strokeWidth: sw }));
  };

  const makeNode = (l: Layer): Konva.Image => {
    const node = new K.Image({ id: l.id, image: undefined });
    node.on('mousedown touchstart', () => {
      if (input.selectedLayer !== l.id) cb.onSelect(l.id);
    });
    node.on('dragmove', () => snap(node));
    node.on('dragend', () => {
      snapGroup.destroyChildren();
      cb.onCommit(node.id(), { x: round(node.x()), y: round(node.y()) }, 'Move layer');
    });
    node.on('transformend', () => {
      cb.onCommit(
        node.id(),
        {
          x: round(node.x()),
          y: round(node.y()),
          scale_x: round(node.scaleX(), 4),
          scale_y: round(node.scaleY(), 4),
          rotation: round(node.rotation()),
        },
        'Transform layer',
      );
    });
    node.on('mouseenter', () => {
      if (input.editable && !layerById(node.id())?.locked) container.style.cursor = 'move';
    });
    node.on('mouseleave', () => (container.style.cursor = ''));
    return node;
  };

  const sync = async () => {
    const my = ++version;
    const { variant, size, assets, url } = input;
    bg.size(size);
    bg.fill(variant.background ?? 'transparent');
    const loaded = await Promise.all(
      variant.layers.map(async (l) => {
        const a = assets.get(l.asset);
        const u = a ? url(a.src) : null;
        return { l, a, img: a && u ? await loadImage(u, a.kind) : null };
      }),
    );
    if (my !== version) return;
    const live = new Set(variant.layers.map((l) => l.id));
    for (const [id, n] of nodes)
      if (!live.has(id)) {
        n.destroy();
        nodes.delete(id);
      }
    loaded.forEach(({ l, a, img }, i) => {
      let node = nodes.get(l.id);
      if (!node) {
        node = makeNode(l);
        nodes.set(l.id, node);
        frame.add(node);
      }
      const nat = natural(img, a);
      node.setAttrs({
        image: img ?? undefined,
        name: l.name ?? a?.name ?? l.asset,
        x: l.x ?? 0,
        y: l.y ?? 0,
        width: l.width ?? l.crop?.width ?? nat.w,
        height: l.height ?? l.crop?.height ?? nat.h,
        scaleX: l.scale_x ?? 1,
        scaleY: l.scale_y ?? 1,
        rotation: l.rotation ?? 0,
        opacity: l.opacity ?? 1,
        visible: l.visible !== false && !!img,
        draggable: input.editable && !l.locked,
      });
      if (l.crop) node.crop(l.crop);
      else node.crop({ x: 0, y: 0, width: 0, height: 0 });
      const css = cssFilter(l.filters);
      node.clearCache();
      if (css !== 'none' && img) {
        node.filters([css]);
        try {
          node.cache();
        } catch {
          node.filters([]);
        }
      } else node.filters([]);
      node.zIndex(i + 1);
    });
    layout();
    attach();
    content.batchDraw();
  };

  stage.on('mousedown touchstart', (e) => {
    if (e.target === stage || e.target === bg) cb.onSelect(null);
  });

  await sync();

  return {
    resize(width, height) {
      box = { width, height };
      layout();
    },
    async update(next) {
      const sizeChanged =
        next.size.width !== input.size.width || next.size.height !== input.size.height;
      input = next;
      await sync();
      if (sizeChanged) layout();
    },
    toCanvasPoint(clientX, clientY) {
      const r = container.getBoundingClientRect();
      return { x: (clientX - r.left - PAD) / scale, y: (clientY - r.top - PAD) / scale };
    },
    async toBlob() {
      const { width, height } = input.size;
      overlay.visible(false);
      try {
        return (await stage.toBlob({
          x: PAD,
          y: PAD,
          width: width * scale,
          height: height * scale,
          pixelRatio: 1 / scale,
          mimeType: 'image/png',
        })) as Blob;
      } finally {
        overlay.visible(true);
      }
    },
    refreshTheme() {
      const handle = theme.token('--canvas-handle', 'orange');
      transformer.borderStroke(handle);
      transformer.anchorStroke(handle);
      transformer.anchorFill(theme.token('--canvas-handle-fill', 'white'));
      drawMask();
      drawGuides();
      overlay.batchDraw();
    },
    destroy() {
      version++;
      stage.destroy();
    },
  };
}
