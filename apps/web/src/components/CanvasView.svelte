<script lang="ts">
  // Canvas tab: arrange pictures and text on a shot's canvas variant. Layouts with named slots,
  // text layers (captions), platform safe zones, snapping with labels, multi-select, align /
  // distribute, groups, zoom. The Konva editor (lib/konva-editor.ts) draws and reports gestures;
  // every change is applied here as an undoable op from @storyboard-viewer/format.
  import {
    KNOWN_FILTERS,
    CAPTION_STYLES,
    addAsset,
    addLayer,
    addVariant,
    applyLayout,
    aspectClass,
    assetReferences,
    captionStyle,
    clearSlot,
    duplicateLayers,
    fillSlot,
    groupLayers,
    layerKind,
    moveLayers,
    removeLayers,
    setSlotFit,
    setSlotFrame,
    slotFrameOf,
    textLayerInput,
    ungroupLayers,
    updateAsset,
    updateLayers,
    updateVariant,
    type CanvasVariant,
    type Layer,
    type LayerFilter,
    type LayerPatch,
    type LayoutDef,
    type SbdProject,
    type Variant,
  } from '@storyboard-viewer/format';
  import { onDestroy } from 'svelte';
  import { align, distribute, union, type AlignMode, type Rect } from '../lib/arrange';
  import {
    createEditor,
    type EditorHandle,
    type EditorInput,
    type NodeAttrs,
  } from '../lib/konva-editor';
  import { MOD } from '../lib/menu';
  import { PLATFORMS, type Platform } from '../lib/safe-zones';
  import { app } from '../lib/state.svelte';
  import {
    BOX_COLORS,
    TEXT_COLORS,
    TEXT_DEFAULT_COLOR,
    TEXT_FONTS,
    defaultBox,
    defaultShadow,
    defaultStroke,
    fontSize,
    hexColor,
    measureText,
  } from '../lib/text-render';
  import { theme } from '../lib/theme.svelte';
  import { tooltip } from '../lib/tooltip';
  import { tour } from '../lib/tour.svelte';
  import { ui } from '../lib/ui.svelte';
  import { canvasSize, frameAspect } from '../lib/visual';
  import AssetPicker from './AssetPicker.svelte';
  import Icon from './Icon.svelte';
  import LayoutPicker from './LayoutPicker.svelte';
  import Segmented from './Segmented.svelte';
  import VariantView from './VariantView.svelte';

  const shotId = $derived(app.selectedShot ?? app.shots[0]?.ref.id ?? null);
  const entry = $derived(app.shots.find((s) => s.ref.id === shotId));
  const shot = $derived(entry?.shot);
  const variant = $derived<Variant | undefined>(shot ? app.shownVariant(shot) : undefined);
  const canvas = $derived(variant?.type === 'canvas' ? (variant as CanvasVariant) : null);
  const size = $derived(
    canvas
      ? canvasSize(canvas, app.project?.manifest)
      : canvasSize({ id: 'x', type: 'canvas', layers: [] }, app.project?.manifest),
  );
  const vertical = $derived(aspectClass(size.width, size.height) === 'vertical');
  const editable = $derived(app.canEdit);

  // --- view preferences (per browser)
  function pref<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`sbd:canvas-${key}`);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  }
  function setPref(key: string, v: unknown) {
    try {
      localStorage.setItem(`sbd:canvas-${key}`, JSON.stringify(v));
    } catch {
      /* not remembered */
    }
  }
  let guides = $state(pref('guides', true));
  let snapping = $state(pref('snap', true));
  let platforms = $state<Platform[]>(pref('platforms', []));
  let hintOpen = $state(!pref('hint-done', false));
  $effect(() => setPref('guides', guides));
  $effect(() => setPref('snap', snapping));
  $effect(() => setPref('platforms', platforms));
  const shownPlatforms = $derived(vertical ? platforms : []);

  function dismissHint() {
    hintOpen = false;
    setPref('hint-done', true);
  }

  // --- selection
  let selected = $state<string[]>([]);
  const layers = $derived(canvas?.layers ?? []);
  const byId = $derived(new Map(layers.map((l) => [l.id, l])));
  const sel = $derived(selected.map((id) => byId.get(id)).filter((l): l is Layer => !!l));
  const single = $derived(sel.length === 1 ? sel[0]! : null);
  const allText = $derived(sel.length > 0 && sel.every((l) => layerKind(l) === 'text'));
  const textLayer = $derived(single && layerKind(single) === 'text' ? single : null);
  const groupIds = $derived([...new Set(sel.map((l) => l.group).filter((g): g is string => !!g))]);
  const wholeGroupSelected = $derived(
    groupIds.length === 1 && sel.every((l) => l.group === groupIds[0]),
  );

  // forget layers that are gone (undo, agent edits, another variant)
  $effect(() => {
    const live = selected.filter((id) => byId.has(id));
    if (live.length !== selected.length) selected = live;
  });
  const canvasId = $derived(canvas?.id ?? null);
  $effect(() => {
    void canvasId;
    selected = [];
    editingText = null;
  });

  /** A layer with the rest of its group. */
  function expand(ids: readonly string[]): string[] {
    const out = new Set(ids);
    for (const id of ids) {
      const g = byId.get(id)?.group;
      if (g) for (const l of layers) if (l.group === g) out.add(l.id);
    }
    return layers.map((l) => l.id).filter((id) => out.has(id));
  }

  function pick(id: string | null, mode: 'replace' | 'toggle') {
    if (!id) {
      if (mode === 'replace') selected = [];
      return;
    }
    const members = expand([id]);
    if (mode === 'replace') selected = members;
    else if (selected.includes(id)) selected = selected.filter((x) => !members.includes(x));
    else selected = expand([...selected, ...members]);
  }

  // --- editor
  let host = $state<HTMLDivElement>();
  let stageEl = $state<HTMLDivElement>();
  let handle = $state<EditorHandle | null>(null);
  let creating = false;
  let zoom = $state(1);
  let fitted = $state(true);
  let snapLabels = $state<string[]>([]);
  let editingText = $state<string | null>(null);
  let textBox = $state<{ x: number; y: number; zoom: number; rotation: number } | null>(null);
  let textDraft = $state('');

  $effect(() => {
    const el = stageEl;
    const input: EditorInput | null = canvas
      ? {
          variant: canvas,
          size,
          assets: app.assets,
          url: (src: string) => app.mediaUrl(src),
          selected: [...selected],
          editable,
          guides,
          platforms: [...shownPlatforms],
          snapping,
          editingText,
        }
      : null;
    if (!el || !input) {
      handle?.destroy();
      handle = null;
      return;
    }
    if (handle) void handle.update(input);
    else if (!creating) {
      creating = true;
      void createEditor(el, input, {
        onPick: (id, mode) => pick(id, mode),
        onMarquee: (ids, additive) =>
          (selected = additive ? expand([...selected, ...ids]) : expand(ids)),
        onMove: (ids, dx, dy, dup) => moveBy(ids, dx, dy, dup),
        onTransform: (attrs) => transformed(attrs),
        onEditText: (id) => startTextEdit(id),
        onActivateSlot: (id) => void chooseForSlot(id),
        onView: (v) => {
          zoom = v.zoom;
          fitted = v.fit;
        },
        onSnap: (labels) => (snapLabels = labels),
      }).then((h) => {
        creating = false;
        if (stageEl !== el) {
          h.destroy();
          return;
        }
        handle = h;
        if (host) h.resize(host.clientWidth, host.clientHeight);
      });
    }
  });

  $effect(() => {
    void theme.resolved;
    handle?.refreshTheme();
  });

  $effect(() => {
    if (!host) return;
    const observer = new ResizeObserver(() =>
      handle?.resize(host!.clientWidth, host!.clientHeight),
    );
    observer.observe(host);
    return () => observer.disconnect();
  });

  onDestroy(() => handle?.destroy());

  // --- edits

  const ids = () => ({ s: shot!.id, v: canvas!.id });

  function edit(label: string, fn: (p: SbdProject) => SbdProject, coalesce?: string): boolean {
    if (!shot || !canvas) return false;
    return app.edit(label, fn, coalesce ? { coalesce } : {});
  }

  function patchLayers(patches: Record<string, LayerPatch>, label: string, coalesce?: string) {
    const { s, v } = ids();
    edit(label, (p) => updateLayers(p, s, v, patches), coalesce);
  }
  const patchOne = (id: string, patch: LayerPatch, label: string, coalesce?: string) =>
    patchLayers({ [id]: patch }, label, coalesce);

  function natSize(assetId: string | undefined) {
    const a = assetId ? app.assets.get(assetId) : undefined;
    return { w: a?.width ?? size.width / 2, h: a?.height ?? size.height / 2 };
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;

  /** Moves layers (slot frames move with their pictures); with `dup` the copies move instead. */
  function moveBy(list: string[], dx: number, dy: number, dup: boolean) {
    const { s, v } = ids();
    let newIds: string[] = [];
    const ok = edit(
      dup ? 'Duplicate layers' : list.length > 1 ? 'Move layers' : 'Move layer',
      (p) => {
        let cur = p;
        let target = list;
        if (dup) {
          const r = duplicateLayers(cur, s, v, list, 0);
          cur = r.project;
          target = r.ids;
          newIds = r.ids;
        }
        const cv = cur.shots[s]!.variants!.find((x) => x.id === v) as CanvasVariant;
        const patches: Record<string, LayerPatch> = {};
        for (const id of target) {
          const l = cv.layers.find((x) => x.id === id);
          if (!l) continue;
          const patch: LayerPatch = { x: r2((l.x ?? 0) + dx), y: r2((l.y ?? 0) + dy) };
          if (l.slot) patch.slot = { ...l.slot, x: r2(l.slot.x + dx), y: r2(l.slot.y + dy) };
          patches[id] = patch;
        }
        return updateLayers(cur, s, v, patches);
      },
    );
    if (ok && dup) selected = newIds;
  }

  function transformed(attrs: Record<string, NodeAttrs>) {
    const { s, v } = ids();
    edit(Object.keys(attrs).length > 1 ? 'Transform layers' : 'Transform layer', (p) => {
      let cur = p;
      const patches: Record<string, LayerPatch> = {};
      for (const [id, a] of Object.entries(attrs)) {
        const l = byId.get(id);
        if (!l) continue;
        const kind = layerKind(l);
        const sx = Math.abs(a.scaleX);
        const sy = Math.abs(a.scaleY);
        if (kind === 'text') {
          const k = Math.abs(sy - 1) > 0.001 ? sy : 1;
          patches[id] = {
            x: a.x,
            y: a.y,
            width: r2(a.width * sx),
            rotation: a.rotation || null,
            scale_x: null,
            scale_y: null,
            ...(k !== 1 ? { font_size: Math.max(4, Math.round(fontSize(l) * k)) } : {}),
          };
        } else if (kind === 'slot') {
          patches[id] = {
            x: a.x,
            y: a.y,
            width: r2(a.width * sx),
            height: r2(a.height * sy),
            rotation: a.rotation || null,
            scale_x: null,
            scale_y: null,
          };
        } else if (l.slot) {
          // a picture in a slot: the slot frame follows the handles, the picture re-fits in it
          const f = l.slot;
          const ox = l.x ?? 0;
          const oy = l.y ?? 0;
          cur = setSlotFrame(
            cur,
            s,
            v,
            id,
            {
              x: a.x + (f.x - ox) * sx,
              y: a.y + (f.y - oy) * sy,
              width: f.width * sx,
              height: f.height * sy,
            },
            { rotation: a.rotation || null },
          );
        } else {
          patches[id] = {
            x: a.x,
            y: a.y,
            scale_x: a.scaleX,
            scale_y: a.scaleY,
            rotation: a.rotation || null,
          };
        }
      }
      return Object.keys(patches).length ? updateLayers(cur, s, v, patches) : cur;
    });
  }

  function addLayerFrom(assetId: string, at?: { x: number; y: number }) {
    if (!shot || !canvas) return;
    const { w, h } = natSize(assetId);
    const k = Math.min(1, (size.width * 0.6) / w, (size.height * 0.6) / h);
    const x = at ? at.x - (w * k) / 2 : (size.width - w * k) / 2;
    const y = at ? at.y - (h * k) / 2 : (size.height - h * k) / 2;
    const { s, v } = ids();
    let id = '';
    if (
      app.edit('Add layer', (p) => {
        const r = addLayer(p, s, v, {
          asset: assetId,
          x: Math.round(x),
          y: Math.round(y),
          ...(k !== 1
            ? { scale_x: Math.round(k * 1e4) / 1e4, scale_y: Math.round(k * 1e4) / 1e4 }
            : {}),
        });
        id = r.id;
        return r;
      })
    )
      selected = [id];
  }

  function addText() {
    if (!shot || !canvas) return;
    const { s, v } = ids();
    let id = '';
    const input = textLayerInput(
      { text: 'Your text', style: vertical ? 'bold' : 'subtitle', position: 'middle' },
      size,
    );
    if (
      app.edit('Add text', (p) => {
        const r = addLayer(p, s, v, input);
        id = r.id;
        return r;
      })
    ) {
      selected = [id];
      requestAnimationFrame(() => startTextEdit(id));
    }
  }

  // --- layouts

  let layoutPicker = $state<{ mode: 'new' | 'apply'; fromImage?: string } | null>(null);
  let layoutOpen = $state(false);
  function openLayouts(mode: 'new' | 'apply', fromImage?: string) {
    layoutPicker = { mode, ...(fromImage ? { fromImage } : {}) };
    layoutOpen = true;
  }

  function onLayout(layout: LayoutDef | null) {
    const req = layoutPicker;
    if (!shot || !req) return;
    const sid = shot.id;
    if (req.mode === 'apply' && canvas && layout) {
      const vid = canvas.id;
      edit(
        `Apply layout: ${layout.name}`,
        (p) => applyLayout(p, sid, layout.id, { variantId: vid }).project,
      );
      return;
    }
    let vid = '';
    const ok = app.edit(layout ? `New layout: ${layout.name}` : 'Add canvas variant', (p) => {
      if (layout) {
        const r = applyLayout(p, sid, layout.id, req.fromImage ? { variantId: variant!.id } : {});
        vid = r.id;
        return r.project;
      }
      const r = addVariant(
        p,
        sid,
        { type: 'canvas', name: 'Layout', layers: [] },
        { activate: true },
      );
      vid = r.id;
      return r.project;
    });
    if (ok) app.chooseVariant(app.project!.shots[sid]!, vid);
  }

  // --- slots

  /** Topmost slot (empty or filled) under a canvas point. */
  function slotAt(pt: { x: number; y: number }): Layer | null {
    for (const l of layers.toReversed()) {
      const f = slotFrameOf(l);
      if (f && pt.x >= f.x && pt.x <= f.x + f.width && pt.y >= f.y && pt.y <= f.y + f.height)
        return l;
    }
    return null;
  }

  function fill(slotId: string, assetId: string) {
    const { s, v } = ids();
    if (edit('Fill slot', (p) => fillSlot(p, s, v, slotId, assetId))) selected = [slotId];
  }

  async function chooseForSlot(id: string) {
    const l = byId.get(id);
    const name = slotFrameOf(l!)?.name ?? 'slot';
    const asset = await ui.pickAsset(['image', 'video'], `Picture for “${name}”`);
    if (asset) fill(id, asset);
  }

  function setFit(fit: 'cover' | 'contain') {
    const { s, v } = ids();
    edit(fit === 'cover' ? 'Fill slot' : 'Fit in slot', (p) => {
      let cur = p;
      for (const l of sel) if (slotFrameOf(l)) cur = setSlotFit(cur, s, v, l.id, fit);
      return cur;
    });
  }

  function emptySlot(id: string) {
    const { s, v } = ids();
    edit('Empty slot', (p) => clearSlot(p, s, v, id));
  }

  // --- arrange

  function zMove(dir: 1 | -1) {
    if (!sel.length) return;
    const { s, v } = ids();
    const lowest = Math.min(...sel.map((l) => layers.indexOf(l)));
    const rest = layers.length - sel.length;
    const to = dir > 0 ? Math.min(rest, lowest + 1) : Math.max(0, lowest - 1);
    edit(dir > 0 ? 'Bring forward' : 'Send backward', (p) => moveLayers(p, s, v, selected, to));
  }

  function deleteSelection() {
    if (!sel.length || !editable) return;
    const { s, v } = ids();
    const list = [...selected];
    if (
      edit(list.length > 1 ? `Delete ${list.length} layers` : 'Delete layer', (p) =>
        removeLayers(p, s, v, list),
      )
    )
      selected = [];
  }

  function deleteOne(id: string) {
    const { s, v } = ids();
    const target = selected.includes(id) ? [...selected] : [id];
    if (
      edit(target.length > 1 ? `Delete ${target.length} layers` : 'Delete layer', (p) =>
        removeLayers(p, s, v, target),
      )
    )
      selected = selected.filter((x) => !target.includes(x));
  }

  function duplicateSelection() {
    if (!sel.length) return;
    const { s, v } = ids();
    let out: string[] = [];
    if (
      edit(sel.length > 1 ? 'Duplicate layers' : 'Duplicate layer', (p) => {
        const r = duplicateLayers(p, s, v, selected);
        out = r.ids;
        return r.project;
      })
    )
      selected = out;
  }

  function group() {
    if (sel.length < 2) return;
    const { s, v } = ids();
    edit('Group', (p) => groupLayers(p, s, v, selected).project);
  }
  function ungroup() {
    if (!groupIds.length) return;
    const { s, v } = ids();
    edit('Ungroup', (p) => ungroupLayers(p, s, v, groupIds));
  }

  let alignTo = $state<'selection' | 'frame'>('selection');
  const frameRect: Rect = $derived({ x: 0, y: 0, width: size.width, height: size.height });

  /** Selected items as units: a whole group moves as one box. */
  function units(): Map<string, { ids: string[]; rect: Rect }> {
    const out = new Map<string, { ids: string[]; rect: Rect }>();
    const boxes = handle?.boxes(selected) ?? new Map();
    for (const l of sel) {
      const r = boxes.get(l.id);
      if (!r) continue;
      const key = l.group ?? l.id;
      const u = out.get(key);
      if (u) {
        u.ids.push(l.id);
        u.rect = union([u.rect, r]);
      } else out.set(key, { ids: [l.id], rect: r });
    }
    return out;
  }

  function applyDeltas(
    moves: Map<string, { dx: number; dy: number }>,
    u: Map<string, { ids: string[] }>,
    label: string,
  ) {
    const patches: Record<string, LayerPatch> = {};
    for (const [key, d] of moves) {
      if (Math.abs(d.dx) < 0.005 && Math.abs(d.dy) < 0.005) continue;
      for (const id of u.get(key)!.ids) {
        const l = byId.get(id)!;
        if (l.locked) continue;
        const patch: LayerPatch = { x: r2((l.x ?? 0) + d.dx), y: r2((l.y ?? 0) + d.dy) };
        if (l.slot) patch.slot = { ...l.slot, x: r2(l.slot.x + d.dx), y: r2(l.slot.y + d.dy) };
        patches[id] = patch;
      }
    }
    if (Object.keys(patches).length) patchLayers(patches, label);
  }

  function doAlign(mode: AlignMode) {
    const u = units();
    if (!u.size) return;
    const rects = new Map([...u].map(([k, x]) => [k, x.rect]));
    const ref = alignTo === 'frame' || u.size === 1 ? frameRect : union([...rects.values()]);
    applyDeltas(align(rects, mode, ref), u, 'Align');
  }

  function doDistribute(axis: 'x' | 'y') {
    const u = units();
    const rects = new Map([...u].map(([k, x]) => [k, x.rect]));
    applyDeltas(
      distribute(rects, axis, alignTo === 'frame' ? frameRect : undefined),
      u,
      'Distribute',
    );
  }

  /** Fit / Fill the frame (pictures; pictures in slots fit their slot) or center. */
  function fitSel(mode: 'fit' | 'fill' | 'center') {
    if (!sel.length) return;
    if (mode !== 'center' && sel.every((l) => slotFrameOf(l))) {
      setFit(mode === 'fit' ? 'contain' : 'cover');
      return;
    }
    if (mode === 'center') {
      const b = handle?.bounds(selected);
      if (!b) return;
      const u = units();
      const moves = new Map<string, { dx: number; dy: number }>();
      const dx = (size.width - b.width) / 2 - b.x;
      const dy = (size.height - b.height) / 2 - b.y;
      for (const k of u.keys()) moves.set(k, { dx, dy });
      applyDeltas(moves, u, 'Center');
      return;
    }
    const patches: Record<string, LayerPatch> = {};
    for (const l of sel) {
      if (layerKind(l) !== 'image' || l.slot) continue;
      const nat = natSize(l.asset);
      const w = l.width ?? l.crop?.width ?? nat.w;
      const h = l.height ?? l.crop?.height ?? nat.h;
      const k = (mode === 'fit' ? Math.min : Math.max)(size.width / w, size.height / h);
      const sx = Math.sign(l.scale_x ?? 1) * k;
      const sy = Math.sign(l.scale_y ?? 1) * k;
      patches[l.id] = {
        scale_x: Math.round(sx * 1e4) / 1e4,
        scale_y: Math.round(sy * 1e4) / 1e4,
        rotation: null,
        x: Math.round((size.width - w * k) / 2),
        y: Math.round((size.height - h * k) / 2),
      };
    }
    if (Object.keys(patches).length)
      patchLayers(patches, mode === 'fit' ? 'Fit to frame' : 'Fill frame');
  }

  // --- numeric fields

  /** What the fields show: the layer's box (single) or the selection's box (several). */
  const metrics = $derived.by(() => {
    void app.project;
    if (!sel.length) return null;
    if (single) {
      const l = single;
      const kind = layerKind(l);
      if (kind === 'text') {
        const m = measureText(l);
        return {
          x: l.x ?? 0,
          y: l.y ?? 0,
          w: m.width,
          h: m.height,
          r: l.rotation ?? 0,
          hFixed: true,
        };
      }
      if (kind === 'slot')
        return {
          x: l.x ?? 0,
          y: l.y ?? 0,
          w: l.width ?? 0,
          h: l.height ?? 0,
          r: l.rotation ?? 0,
          hFixed: false,
        };
      if (l.slot)
        return {
          x: l.slot.x,
          y: l.slot.y,
          w: l.slot.width,
          h: l.slot.height,
          r: l.rotation ?? 0,
          hFixed: false,
        };
      const nat = natSize(l.asset);
      const w = (l.width ?? l.crop?.width ?? nat.w) * Math.abs(l.scale_x ?? 1);
      const h = (l.height ?? l.crop?.height ?? nat.h) * Math.abs(l.scale_y ?? 1);
      return { x: l.x ?? 0, y: l.y ?? 0, w, h, r: l.rotation ?? 0, hFixed: false };
    }
    const b = handle?.bounds(selected);
    return b ? { x: b.x, y: b.y, w: b.width, h: b.height, r: null, hFixed: true } : null;
  });
  let keepRatio = $state(true);
  const num = (e: Event) => Number((e.target as HTMLInputElement).value);
  const show = (n: number) => Math.round(n * 100) / 100;

  function setField(key: 'x' | 'y' | 'w' | 'h' | 'r', value: number) {
    if (!metrics || !Number.isFinite(value)) return;
    if (!single) {
      if (key !== 'x' && key !== 'y') return;
      const u = units();
      const d = key === 'x' ? { dx: value - metrics.x, dy: 0 } : { dx: 0, dy: value - metrics.y };
      const moves = new Map([...u.keys()].map((k) => [k, d]));
      applyDeltas(moves, u, 'Move layers');
      return;
    }
    const l = single;
    const kind = layerKind(l);
    if (key === 'r') {
      patchOne(l.id, { rotation: value || null }, 'Rotate layer');
      return;
    }
    if (key === 'x' || key === 'y') {
      const d = value - (key === 'x' ? metrics.x : metrics.y);
      const dx = key === 'x' ? d : 0;
      const dy = key === 'y' ? d : 0;
      moveBy([l.id], dx, dy, false);
      return;
    }
    if (value <= 0) return;
    const ratio = metrics.h / metrics.w;
    const w = key === 'w' ? value : keepRatio ? value / ratio : metrics.w;
    const h = key === 'h' ? value : keepRatio ? value * ratio : metrics.h;
    if (kind === 'text') {
      patchOne(l.id, { width: r2(w) }, 'Resize text');
    } else if (kind === 'slot') {
      patchOne(l.id, { width: r2(w), height: r2(h) }, 'Resize slot');
    } else if (l.slot) {
      const { s, v } = ids();
      edit('Resize slot', (p) =>
        setSlotFrame(p, s, v, l.id, { x: l.slot!.x, y: l.slot!.y, width: w, height: h }),
      );
    } else {
      const nat = natSize(l.asset);
      const bw = l.width ?? l.crop?.width ?? nat.w;
      const bh = l.height ?? l.crop?.height ?? nat.h;
      patchOne(
        l.id,
        {
          scale_x: Math.round((Math.sign(l.scale_x ?? 1) * w * 1e4) / bw) / 1e4,
          scale_y: Math.round((Math.sign(l.scale_y ?? 1) * h * 1e4) / bh) / 1e4,
        },
        'Resize layer',
      );
    }
  }

  // --- text

  function startTextEdit(id: string) {
    const l = byId.get(id);
    if (!l || layerKind(l) !== 'text' || !editable || l.locked) return;
    selected = expand([id]).includes(id) && selected.includes(id) ? selected : [id];
    textDraft = l.text ?? '';
    editingText = id;
    requestAnimationFrame(() => {
      textBox = handle?.screenBox(id) ?? null;
    });
  }

  function finishTextEdit(commit: boolean) {
    const id = editingText;
    if (!id) return;
    const l = byId.get(id);
    editingText = null;
    textBox = null;
    if (commit && l && textDraft !== l.text) patchOne(id, { text: textDraft }, 'Edit text');
    stageEl?.focus();
  }

  function textPatch(patch: LayerPatch, label: string, coalesce?: string) {
    const patches: Record<string, LayerPatch> = {};
    for (const l of sel) if (layerKind(l) === 'text') patches[l.id] = patch;
    if (Object.keys(patches).length) patchLayers(patches, label, coalesce);
  }

  function applyStyle(id: string) {
    const patches: Record<string, LayerPatch> = {};
    for (const l of sel) if (layerKind(l) === 'text') patches[l.id] = captionStyle(id, size);
    patchLayers(patches, 'Caption style');
  }

  const fontAssets = $derived((app.project?.assets.assets ?? []).filter((a) => a.kind === 'font'));
  const WEIGHTS = [
    { value: 400, label: 'Regular' },
    { value: 600, label: 'Semibold' },
    { value: 800, label: 'Heavy' },
  ];

  // --- filters (image layers)

  function setFilter(type: string, value: number | null) {
    const layer = single;
    if (!layer) return;
    const def = FILTER_DEFAULTS[type] ?? 0;
    const others = (layer.filters ?? []).filter((f) => f.type !== type);
    const filters: LayerFilter[] =
      value === null || Math.abs(value - def) < 1e-6 ? others : [...others, { type, value }];
    filters.sort(
      (a, b) => KNOWN_FILTERS.indexOf(a.type as never) - KNOWN_FILTERS.indexOf(b.type as never),
    );
    patchOne(
      layer.id,
      { filters: filters.length ? filters : null },
      'Adjust filter',
      `${layer.id}:filter:${type}`,
    );
  }
  const filterValue = (type: string) =>
    single?.filters?.find((f) => f.type === type)?.value ?? FILTER_DEFAULTS[type] ?? 0;

  const FILTER_DEFAULTS: Record<string, number> = {
    brightness: 1,
    contrast: 1,
    saturate: 1,
    hue_rotate: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
  };
  const FILTERS: Array<{ type: string; label: string; min: number; max: number; step: number }> = [
    { type: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01 },
    { type: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.01 },
    { type: 'saturate', label: 'Saturation', min: 0, max: 2, step: 0.01 },
    { type: 'hue_rotate', label: 'Hue', min: -180, max: 180, step: 1 },
    { type: 'blur', label: 'Blur', min: 0, max: 40, step: 0.5 },
    { type: 'grayscale', label: 'Grayscale', min: 0, max: 1, step: 0.01 },
  ];

  function setCrop(key: 'x' | 'y' | 'width' | 'height', value: number) {
    const layer = single;
    if (!layer) return;
    const nat = natSize(layer.asset);
    const old = layer.crop ?? { x: 0, y: 0, width: nat.w, height: nat.h };
    const crop = { ...old, [key]: Math.max(key === 'x' || key === 'y' ? 0 : 1, Math.round(value)) };
    const kx = (layer.width ?? old.width) / old.width;
    const ky = (layer.height ?? old.height) / old.height;
    const patch: LayerPatch = { crop };
    if (layer.width !== undefined) patch.width = Math.round(crop.width * kx * 100) / 100;
    if (layer.height !== undefined) patch.height = Math.round(crop.height * ky * 100) / 100;
    patchOne(layer.id, patch, 'Crop layer', `${layer.id}:crop`);
  }

  async function flatten() {
    if (!handle || !shot || !canvas) return;
    flattening = true;
    try {
      const blob = await handle.toBlob();
      const file = new File([blob], `${shot.id}-${canvas.id}-preview.png`, { type: 'image/png' });
      const input = await app.prepareFile(file);
      const { s, v } = ids();
      const old = canvas.preview;
      app.edit('Flatten to preview', (p: SbdProject) => {
        const refs = old ? assetReferences(p, old) : [];
        if (old && refs.length === 1) {
          const { name: _n, ...rest } = input;
          return updateAsset(p, old, rest);
        }
        const r = addAsset(p, {
          ...input,
          name: `${shot!.title ?? shot!.id} preview`,
          tags: ['preview'],
        });
        return updateVariant(r.project, s, v, { preview: r.id });
      });
      app.toast('Saved a flattened preview image for this layout', { kind: 'info' });
    } catch (e) {
      app.toast(`Could not flatten: ${(e as Error).message}`, { kind: 'error' });
    } finally {
      flattening = false;
    }
  }
  let flattening = $state(false);
  let picker = $state(false);

  // --- keyboard

  function onStageKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ' && !mod) {
      e.preventDefault(); // Space pans here (not play/pause)
      if (!e.repeat) handle?.setPanKey(true);
      return;
    }
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      handle?.zoomBy(1.25);
      return;
    }
    if (mod && e.key === '-') {
      e.preventDefault();
      handle?.zoomBy(0.8);
      return;
    }
    if (mod && e.code === 'Digit0') {
      e.preventDefault();
      handle?.zoomTo('fit');
      return;
    }
    if (!mod && e.shiftKey && e.code === 'Digit0') {
      e.preventDefault();
      handle?.zoomTo(1);
      return;
    }
    if (mod && k === 'a') {
      e.preventDefault();
      selected = layers.filter((l) => l.visible !== false && !l.locked).map((l) => l.id);
      return;
    }
    if (e.key === 'Escape') {
      if (selected.length) {
        e.preventDefault();
        selected = [];
      }
      return;
    }
    if (!editable || !sel.length) return;
    const step = e.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = nudge[e.key];
    if (d && !mod) {
      e.preventDefault();
      const movable = sel.filter((l) => !l.locked);
      const patches: Record<string, LayerPatch> = {};
      for (const l of movable) {
        const patch: LayerPatch = { x: r2((l.x ?? 0) + d[0]), y: r2((l.y ?? 0) + d[1]) };
        if (l.slot) patch.slot = { ...l.slot, x: r2(l.slot.x + d[0]), y: r2(l.slot.y + d[1]) };
        patches[l.id] = patch;
      }
      if (movable.length) patchLayers(patches, 'Nudge', `nudge:${selected.join(',')}`);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === ']') zMove(1);
    else if (e.key === '[') zMove(-1);
    else if (mod && k === 'd') {
      e.preventDefault();
      duplicateSelection();
    } else if (mod && k === 'g') {
      e.preventDefault();
      if (e.shiftKey) ungroup();
      else group();
    } else if (e.key === 'Enter' && single) {
      e.preventDefault();
      if (layerKind(single) === 'text') startTextEdit(single.id);
      else if (layerKind(single) === 'slot') void chooseForSlot(single.id);
    }
  }

  function onStageKeyUp(e: KeyboardEvent) {
    if (e.key === ' ') handle?.setPanKey(false);
  }

  // --- drag and drop of images onto the frame / a slot

  let dropping = $state(false);
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    if (!canvas || !handle || !editable) return;
    const at = handle.toCanvasPoint(e.clientX, e.clientY);
    const slot = slotAt(at);
    const place = (assetId: string) => (slot ? fill(slot.id, assetId) : addLayerFrom(assetId, at));
    const assetId = e.dataTransfer?.getData('application/x-sbd-asset');
    if (assetId) {
      place(assetId);
      return;
    }
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /^(image|video)\//.test(f.type));
    if (files.length)
      void app
        .importFiles(files)
        .then((added) => added.forEach((id, i) => (i === 0 ? place(id) : addLayerFrom(id, at))));
  }

  // --- layer list

  const layerName = (l: Layer) => {
    const kind = layerKind(l);
    if (l.name && kind !== 'slot') return l.name;
    if (kind === 'text') return (l.text ?? '').split('\n')[0]!.slice(0, 40) || 'Text';
    if (kind === 'slot') return `${l.name ?? 'Slot'} (empty)`;
    const asset = app.assets.get(l.asset ?? '')?.name ?? l.asset ?? 'Layer';
    return l.slot?.name ? `${l.slot.name} · ${asset}` : asset;
  };
  const kindIcon = (l: Layer) =>
    layerKind(l) === 'text' ? 'text' : layerKind(l) === 'slot' ? 'layout' : 'image';

  let renaming = $state<string | null>(null);
  let dragRow = $state<string | null>(null);
  let dropRow = $state<{ id: string; after: boolean } | null>(null);

  /** Rows top-first; a group's first row carries its header. */
  const rows = $derived(
    layers.toReversed().map((l, i, arr) => ({
      l,
      head: !!l.group && arr[i - 1]?.group !== l.group,
      grouped: !!l.group,
    })),
  );

  function rowClick(e: MouseEvent, id: string) {
    pick(id, e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace');
  }

  /** Moves a row (with its group or the selection it belongs to) one step up/down the stack. */
  function moveRow(id: string, dir: 1 | -1) {
    const set = selected.includes(id) ? selected : expand([id]);
    const lowest = Math.min(...set.map((x) => layers.findIndex((l) => l.id === x)));
    const to = Math.max(0, Math.min(layers.length - set.length, lowest + dir));
    const { s, v } = ids();
    edit(dir > 0 ? 'Bring forward' : 'Send backward', (p) => moveLayers(p, s, v, set, to));
  }

  function dropOnRow(targetId: string, after: boolean) {
    const from = dragRow;
    dragRow = null;
    dropRow = null;
    if (!from || from === targetId) return;
    const set = selected.includes(from) ? [...selected] : expand([from]);
    if (set.includes(targetId)) return;
    const rest = layers.filter((l) => !set.includes(l.id));
    const ti = rest.findIndex((l) => l.id === targetId);
    // rows are top-first: "after" in the list = below = lower index in the stack
    const to = after ? ti : ti + 1;
    const { s, v } = ids();
    edit('Reorder layers', (p) => moveLayers(p, s, v, set, to));
  }

  function rowKey(e: KeyboardEvent, id: string) {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveRow(id, e.key === 'ArrowUp' ? 1 : -1);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`button.name[data-layer-id="${CSS.escape(id)}"]`)
          ?.focus(),
      );
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable) {
      e.preventDefault();
      if (!selected.includes(id)) selected = expand([id]);
      deleteSelection();
    } else if (e.key === 'Escape') selected = [];
  }

  const imageAssets = $derived(
    (app.project?.assets.assets ?? []).filter((a) => a.kind === 'image' || a.kind === 'video'),
  );
  const crop = $derived(
    single && layerKind(single) === 'image'
      ? (single.crop ?? {
          x: 0,
          y: 0,
          width: natSize(single.asset).w,
          height: natSize(single.asset).h,
        })
      : null,
  );
  const slotLayers = $derived(sel.filter((l) => slotFrameOf(l)));
  const slotFit = $derived(
    slotLayers.length ? (slotFrameOf(slotLayers[0]!)?.fit ?? 'cover') : 'cover',
  );
  const textStyle = $derived(textLayer?.style ?? null);
  const textInSel = $derived(sel.find((l) => layerKind(l) === 'text') ?? null);
</script>

<div class="canvas-view">
  <nav class="shots" aria-label="Shots">
    <ol>
      {#each app.shots as { ref, shot: s, index } (ref.id)}
        <li>
          <button
            type="button"
            data-shot-id={ref.id}
            aria-current={ref.id === shotId ? 'true' : undefined}
            onclick={() => app.selectShot(ref.id)}
          >
            <span class="mono num">{String(index + 1).padStart(2, '0')}</span>
            <span class="t">{s.title ?? ref.id}</span>
            {#if s.variants?.some((v) => v.type === 'canvas')}<span class="tag">layers</span>{/if}
          </button>
        </li>
      {/each}
    </ol>
  </nav>

  <section class="main" aria-label="Canvas">
    {#if shot}
      <div class="variant-tabs" role="group" aria-label="Variants">
        {#each shot.variants ?? [] as v, i (v.id)}
          <button
            type="button"
            class="chip"
            data-variant-id={v.id}
            aria-pressed={v.id === variant?.id}
            onclick={() => app.chooseVariant(shot, v.id)}
          >
            {v.name ?? `Variant ${i + 1}`}
            <span class="count">{v.type === 'canvas' ? 'layers' : 'image'}</span>
          </button>
        {/each}
        {#if editable}
          <button
            type="button"
            class="chip add"
            id="new-canvas"
            data-tour="canvas-new"
            onclick={() => openLayouts('new')}
            {@attach tooltip('New canvas variant, from a layout or blank')}
          >
            <Icon name="plus" size={12} /> Canvas
          </button>
        {/if}
      </div>
      {#if canvas}
        <div class="toolbar" role="toolbar" aria-label="Canvas tools" data-tour="canvas-toolbar">
          {#if editable}
            <div class="tool-group">
              <button
                type="button"
                class="tool"
                id="apply-layout"
                data-tour="canvas-layout"
                onclick={() => openLayouts('apply')}
                {@attach tooltip('Arrange this canvas with a layout: slots for your pictures')}
                ><Icon name="layout" /><span>Layout</span></button
              >
              <button
                type="button"
                class="tool"
                id="add-layer"
                data-tour="canvas-image"
                onclick={() => (picker = true)}
                {@attach tooltip('Add a picture as a layer (or drag one from the right)')}
                ><Icon name="image" /><span>Image</span></button
              >
              <button
                type="button"
                class="tool"
                id="add-text"
                data-tour="canvas-text"
                onclick={addText}
                {@attach tooltip('Add text: captions, hooks, titles. Double-click text to edit it')}
                ><Icon name="text" /><span>Text</span></button
              >
            </div>
          {/if}
          <div class="tool-group" data-tour="canvas-guides">
            <button
              type="button"
              class="tool"
              id="toggle-guides"
              aria-pressed={guides}
              onclick={() => (guides = !guides)}
              {@attach tooltip('Title-safe (80 %) and action-safe (90 %) guides')}
              ><Icon name="frame" /><span>Safe area</span></button
            >
            {#if vertical}
              <span class="phone" aria-hidden="true"><Icon name="phone" /></span>
              {#each PLATFORMS as p (p.id)}
                <button
                  type="button"
                  class="tool slim"
                  data-platform={p.id}
                  aria-pressed={platforms.includes(p.id)}
                  onclick={() =>
                    (platforms = platforms.includes(p.id)
                      ? platforms.filter((x) => x !== p.id)
                      : [...platforms, p.id])}
                  {@attach tooltip(
                    `Show where ${p.name} puts its buttons and captions (approximate)`,
                  )}><span>{p.name}</span></button
                >
              {/each}
            {/if}
            <button
              type="button"
              class="tool"
              id="toggle-snap"
              aria-pressed={snapping}
              onclick={() => (snapping = !snapping)}
              {@attach tooltip(
                `Snap to guides: frame, safe areas, other layers and slots. Hold ${MOD === '⌘' ? '⌘' : 'Ctrl'} or Alt while dragging to move freely`,
              )}><Icon name="magnet" /><span>Snap to guides</span></button
            >
          </div>
          <div class="tool-group zoom" data-tour="canvas-zoom">
            <button
              type="button"
              class="tool icon-only"
              id="zoom-out"
              onclick={() => handle?.zoomBy(0.8)}
              {@attach tooltip('Zoom out', `${MOD}−`)}><Icon name="zoomOut" /></button
            >
            <button
              type="button"
              class="tool zoom-level mono"
              id="zoom-100"
              onclick={() => handle?.zoomTo(1)}
              {@attach tooltip('Actual size (100 %)', '⇧0')}
              ><span id="zoom-level">{Math.round(zoom * 100)}%</span></button
            >
            <button
              type="button"
              class="tool icon-only"
              id="zoom-in"
              onclick={() => handle?.zoomBy(1.25)}
              {@attach tooltip('Zoom in', `${MOD}+`)}><Icon name="zoomIn" /></button
            >
            <button
              type="button"
              class="tool"
              id="zoom-fit"
              aria-pressed={fitted}
              onclick={() => handle?.zoomTo('fit')}
              {@attach tooltip('Zoom to fit. Space-drag or scroll to pan', `${MOD}0`)}
              ><Icon name="expand" /><span>Fit</span></button
            >
          </div>
          {#if editable}
            <button
              type="button"
              class="tool"
              disabled={flattening}
              onclick={flatten}
              {@attach tooltip("Render this layout to an image saved as the variant's preview")}
              ><Icon name="download" /><span>Flatten</span></button
            >
          {/if}
        </div>
        {#if hintOpen && editable}
          <div class="hint-strip" id="canvas-hint" role="note">
            <span
              >Drop pictures on the frame or a slot · double-click text to edit · Shift-click or
              drag a box to select · {MOD === '⌘' ? '⌘' : 'Ctrl'}-drag moves without snapping</span
            >
            <button
              type="button"
              class="btn small ghost"
              onclick={() => {
                dismissHint();
                void tour.start('canvas');
              }}>Take the tour</button
            >
            <button
              type="button"
              class="btn small ghost"
              id="canvas-hint-close"
              onclick={dismissHint}>Got it</button
            >
          </div>
        {/if}
      {/if}
      <div
        class="stage-host"
        class:dropping
        bind:this={host}
        role="presentation"
        ondragover={(e) => {
          if (canvas && editable) {
            e.preventDefault();
            dropping = true;
          }
        }}
        ondragleave={() => (dropping = false)}
        ondrop={onDrop}
      >
        {#if canvas}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            class="stage"
            bind:this={stageEl}
            role="application"
            tabindex="0"
            data-tour="canvas-stage"
            aria-roledescription="canvas editor"
            aria-label="Canvas editor, {canvas.layers.length} layers{sel.length
              ? `, ${sel.length > 1 ? `${sel.length} layers` : layerName(sel[0]!)} selected. Arrow keys move, Shift for 10 pixels, [ and ] change order, Delete removes, ${MOD}D duplicates, Enter edits text`
              : `. ${MOD}A selects all`}"
            data-variant-id={canvas.id}
            onkeydown={onStageKey}
            onkeyup={onStageKeyUp}
            onblur={() => handle?.setPanKey(false)}
          ></div>
          {#if editingText && textBox && byId.get(editingText)}
            {@const l = byId.get(editingText)!}
            <textarea
              class="text-editor"
              id="text-editor"
              aria-label="Edit text"
              bind:value={textDraft}
              {@attach (el) => {
                const t = el as HTMLTextAreaElement;
                t.focus();
                t.select();
              }}
              style:left="{textBox.x}px"
              style:top="{textBox.y}px"
              style:width="{(l.width ?? 800) * textBox.zoom}px"
              style:transform="rotate({textBox.rotation}deg)"
              style:font-family={l.font_asset ? undefined : (l.font ?? 'IBM Plex Sans')}
              style:font-size="{fontSize(l) * textBox.zoom}px"
              style:font-weight={l.font_weight ?? 400}
              style:line-height={l.line_height ?? 1.2}
              style:text-align={l.align ?? 'center'}
              style:color={l.color ?? 'white'}
              style:text-transform={l.uppercase ? 'uppercase' : undefined}
              style:padding="{(l.box ? (l.box.padding ?? fontSize(l) * 0.3) : 0) * textBox.zoom}px"
              rows={Math.max(1, textDraft.split('\n').length)}
              onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') finishTextEdit(false);
                else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finishTextEdit(true);
              }}
              onblur={() => finishTextEdit(true)}></textarea>
          {/if}
        {:else}
          <div class="single" style:aspect-ratio={frameAspect(app.project?.manifest)}>
            <VariantView {variant} label={shot.title ?? shot.id} />
          </div>
        {/if}
      </div>
      <p class="status-line muted" id="snap-status" role="status" aria-live="polite">
        {#if snapLabels.length}Snapped to {snapLabels.join(' and ')}{/if}
      </p>
      {#if !canvas && editable}
        <p class="muted hint">
          {#if variant?.type === 'image'}
            This variant is a single image.
            <button
              type="button"
              class="link"
              id="convert-to-layout"
              onclick={() => openLayouts('new', (variant as { asset: string }).asset)}
              >Make it a layout</button
            > to put text and more pictures on it.
          {:else}
            No layout yet. <button
              type="button"
              class="link"
              id="create-canvas"
              onclick={() => openLayouts('new')}>Create a canvas</button
            >
            to arrange pictures and text.
          {/if}
        </p>
      {/if}
    {:else}
      <p class="muted hint">No shots yet.</p>
    {/if}
  </section>

  <aside class="side" aria-label="Layers">
    {#if canvas}
      <h2>Layers <span class="muted mono">{size.width} × {size.height}</span></h2>
      {#if !canvas.layers.length}
        <p class="muted empty">Pick a layout, drag pictures onto the frame, or add text.</p>
      {/if}
      <ol class="layer-list" id="layer-list" data-tour="canvas-layers">
        {#each rows as { l, head, grouped } (l.id)}
          {#if head}
            <li class="group-head">
              <button
                type="button"
                class="name"
                data-group-id={l.group}
                onclick={() => pick(l.id, 'replace')}
              >
                <Icon name="group" size={13} /><span class="t">Group</span>
              </button>
            </li>
          {/if}
          <li
            class:selected={selected.includes(l.id)}
            class:hidden-layer={l.visible === false}
            class:grouped
            class:drop-before={dropRow?.id === l.id && !dropRow.after}
            class:drop-after={dropRow?.id === l.id && dropRow.after}
            data-layer-row={l.id}
            ondragover={(e) => {
              if (!dragRow) return;
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              dropRow = { id: l.id, after: e.clientY > r.top + r.height / 2 };
            }}
            ondragleave={() => {
              if (dropRow?.id === l.id) dropRow = null;
            }}
            ondrop={(e) => {
              e.preventDefault();
              if (dropRow) dropOnRow(dropRow.id, dropRow.after);
            }}
          >
            {#if editable}
              <!-- role=button span: Chromium does not drag from <button> -->
              <span
                class="grip"
                role="button"
                tabindex="-1"
                aria-label="Drag to reorder {layerName(l)} (or Alt+↑/↓ on the layer)"
                draggable="true"
                ondragstart={(e) => {
                  dragRow = l.id;
                  e.dataTransfer?.setData('text/plain', l.id);
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                }}
                ondragend={() => {
                  dragRow = null;
                  dropRow = null;
                }}><Icon name="grip" size={12} /></span
              >
            {/if}
            {#if renaming === l.id}
              <input
                class="rename"
                aria-label="Layer name"
                value={l.name ?? layerName(l)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') renaming = null;
                }}
                onblur={(e) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (renaming === l.id && v && v !== layerName(l))
                    patchOne(l.id, { name: v }, 'Rename layer');
                  renaming = null;
                }}
                {@attach (el) => (el as HTMLInputElement).select()}
              />
            {:else}
              <button
                type="button"
                class="name"
                data-layer-id={l.id}
                aria-pressed={selected.includes(l.id)}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
                ondblclick={() => editable && (renaming = l.id)}
                onclick={(e) => rowClick(e, l.id)}
                onkeydown={(e) => rowKey(e, l.id)}
              >
                <Icon name={kindIcon(l)} size={13} />
                <span class="t">{layerName(l)}</span>
              </button>
            {/if}
            {#if editable}
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="{l.visible === false ? 'Show' : 'Hide'} {layerName(l)}"
                aria-pressed={l.visible === false}
                onclick={() =>
                  patchOne(
                    l.id,
                    { visible: l.visible === false ? null : false },
                    l.visible === false ? 'Show layer' : 'Hide layer',
                  )}
                {@attach tooltip(l.visible === false ? 'Show' : 'Hide')}
                ><Icon name={l.visible === false ? 'eyeOff' : 'eye'} size={14} /></button
              >
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="{l.locked ? 'Unlock' : 'Lock'} {layerName(l)}"
                aria-pressed={!!l.locked}
                onclick={() =>
                  patchOne(
                    l.id,
                    { locked: l.locked ? null : true },
                    l.locked ? 'Unlock layer' : 'Lock layer',
                  )}
                {@attach tooltip(l.locked ? 'Unlock' : 'Lock (no moving or resizing)')}
                ><Icon name={l.locked ? 'lock' : 'unlock'} size={14} /></button
              >
              <button
                type="button"
                class="btn ghost icon tiny del"
                data-delete-layer={l.id}
                aria-label="Delete {layerName(l)}"
                onclick={() => deleteOne(l.id)}
                {@attach tooltip('Delete', 'Delete')}><Icon name="close" size={13} /></button
              >
            {/if}
          </li>
        {/each}
      </ol>

      {#if sel.length && editable}
        <section class="props" aria-label="Selection" data-tour="canvas-props">
          <div class="row-tools">
            <button
              type="button"
              class="btn ghost icon tiny"
              onclick={() => zMove(1)}
              {@attach tooltip('Bring forward', ']')}><Icon name="up" size={14} /></button
            >
            <button
              type="button"
              class="btn ghost icon tiny"
              onclick={() => zMove(-1)}
              {@attach tooltip('Send backward', '[')}><Icon name="down" size={14} /></button
            >
            {#if single}
              <button
                type="button"
                class="btn ghost icon tiny"
                onclick={() => (renaming = single.id)}
                {@attach tooltip('Rename')}><Icon name="edit" size={14} /></button
              >
            {/if}
            <button
              type="button"
              class="btn ghost icon tiny"
              id="duplicate-layers"
              onclick={duplicateSelection}
              {@attach tooltip('Duplicate (or Alt-drag)', `${MOD}D`)}
              ><Icon name="copy" size={14} /></button
            >
            {#if sel.length > 1 && !wholeGroupSelected}
              <button
                type="button"
                class="btn ghost icon tiny"
                id="group-layers"
                onclick={group}
                {@attach tooltip('Group', `${MOD}G`)}><Icon name="group" size={14} /></button
              >
            {/if}
            {#if groupIds.length}
              <button
                type="button"
                class="btn ghost icon tiny"
                id="ungroup-layers"
                onclick={ungroup}
                {@attach tooltip('Ungroup', `⇧${MOD}G`)}><Icon name="ungroup" size={14} /></button
              >
            {/if}
            <button
              type="button"
              class="btn ghost icon tiny"
              id="delete-layers"
              onclick={deleteSelection}
              {@attach tooltip(sel.length > 1 ? `Delete ${sel.length} layers` : 'Delete', 'Delete')}
              ><Icon name="trash" size={14} /></button
            >
          </div>

          <div class="row-tools text">
            <button
              type="button"
              class="btn small ghost"
              onclick={() => fitSel('fit')}
              {@attach tooltip('Show the whole picture (in the frame, or in its slot)')}
              ><Icon name="fit" size={13} /> Fit</button
            >
            <button
              type="button"
              class="btn small ghost"
              onclick={() => fitSel('fill')}
              {@attach tooltip('Cover the frame (or its slot), cropping the edges')}
              ><Icon name="fill" size={13} /> Fill</button
            >
            <button
              type="button"
              class="btn small ghost"
              onclick={() => fitSel('center')}
              {@attach tooltip('Center in the frame')}
              ><Icon name="center" size={13} /> Center</button
            >
          </div>

          {#if sel.length > 1}
            <div class="arrange" data-tour="canvas-align">
              <div class="row-tools">
                {#each [['left', 'alignLeft', 'Align left edges'], ['hcenter', 'alignHCenter', 'Align centers'], ['right', 'alignRight', 'Align right edges'], ['top', 'alignTop', 'Align tops'], ['vcenter', 'alignVCenter', 'Align middles'], ['bottom', 'alignBottom', 'Align bottoms']] as const as [mode, icon, label] (mode)}
                  <button
                    type="button"
                    class="btn ghost icon tiny"
                    data-align={mode}
                    onclick={() => doAlign(mode)}
                    {@attach tooltip(label)}><Icon name={icon} size={14} /></button
                  >
                {/each}
                <button
                  type="button"
                  class="btn ghost icon tiny"
                  data-distribute="x"
                  disabled={units().size < 3 && alignTo === 'selection'}
                  onclick={() => doDistribute('x')}
                  {@attach tooltip('Distribute horizontally (equal gaps)')}
                  ><Icon name="distH" size={14} /></button
                >
                <button
                  type="button"
                  class="btn ghost icon tiny"
                  data-distribute="y"
                  disabled={units().size < 3 && alignTo === 'selection'}
                  onclick={() => doDistribute('y')}
                  {@attach tooltip('Distribute vertically (equal gaps)')}
                  ><Icon name="distV" size={14} /></button
                >
              </div>
              <Segmented
                bind:value={alignTo}
                label="Align relative to"
                id="align-to"
                options={[
                  { value: 'selection', label: 'To selection' },
                  { value: 'frame', label: 'To frame' },
                ]}
              />
            </div>
          {/if}

          {#if metrics}
            <div class="grid4" data-tour="canvas-numbers">
              <label
                ><span>X</span><input
                  type="number"
                  step="1"
                  value={show(metrics.x)}
                  onchange={(e) => setField('x', num(e))}
                /></label
              >
              <label
                ><span>Y</span><input
                  type="number"
                  step="1"
                  value={show(metrics.y)}
                  onchange={(e) => setField('y', num(e))}
                /></label
              >
              <label
                ><span>W</span><input
                  type="number"
                  step="1"
                  min="1"
                  disabled={!single}
                  value={show(metrics.w)}
                  onchange={(e) => setField('w', num(e))}
                /></label
              >
              <label
                ><span>H</span><input
                  type="number"
                  step="1"
                  min="1"
                  disabled={!single || metrics.hFixed}
                  value={show(metrics.h)}
                  onchange={(e) => setField('h', num(e))}
                /></label
              >
              <label class="rot"
                ><span>Rotation °</span><input
                  type="number"
                  step="1"
                  disabled={!single}
                  value={metrics.r ?? ''}
                  onchange={(e) => setField('r', num(e))}
                /></label
              >
              {#if single && !metrics.hFixed}
                <button
                  type="button"
                  class="btn ghost icon tiny ratio"
                  aria-pressed={keepRatio}
                  aria-label="Keep proportions"
                  onclick={() => (keepRatio = !keepRatio)}
                  {@attach tooltip(keepRatio ? 'Proportions locked' : 'Proportions free')}
                  ><Icon name={keepRatio ? 'lock' : 'unlock'} size={13} /></button
                >
              {/if}
            </div>
          {/if}

          {#if slotLayers.length}
            <div class="slot-props">
              <Segmented
                value={slotFit}
                label="Picture in slot"
                options={[
                  { value: 'cover', label: 'Fill slot' },
                  { value: 'contain', label: 'Fit in slot' },
                ]}
                onchange={(v: string) => setFit(v as 'cover' | 'contain')}
              />
              {#if single && slotFrameOf(single)}
                <div class="row-tools text">
                  <button
                    type="button"
                    class="btn small ghost"
                    id="choose-slot-image"
                    onclick={() => void chooseForSlot(single.id)}
                    ><Icon name="image" size={13} />
                    {layerKind(single) === 'slot' ? 'Choose image…' : 'Replace image…'}</button
                  >
                  {#if layerKind(single) !== 'slot'}
                    <button
                      type="button"
                      class="btn small ghost"
                      onclick={() => emptySlot(single.id)}>Empty slot</button
                    >
                  {/if}
                </div>
              {/if}
            </div>
          {/if}

          {#if allText && textInSel}
            {@const t = textInSel}
            <div class="text-props" data-tour="canvas-text-props">
              {#if textLayer}
                <label class="block"
                  ><span>Text</span><textarea
                    id="text-content"
                    rows="2"
                    value={textLayer.text ?? ''}
                    oninput={(e) =>
                      patchOne(
                        textLayer.id,
                        { text: (e.target as HTMLTextAreaElement).value },
                        'Edit text',
                        `${textLayer.id}:text`,
                      )}></textarea></label
                >
              {/if}
              <div class="chips" role="group" aria-label="Caption style">
                {#each CAPTION_STYLES as c (c.id)}
                  <button
                    type="button"
                    class="chip"
                    data-caption-style={c.id}
                    aria-pressed={textStyle === c.id}
                    onclick={() => applyStyle(c.id)}
                    {@attach tooltip(c.description)}>{c.label}</button
                  >
                {/each}
              </div>
              <div class="chips" role="group" aria-label="Font">
                {#each TEXT_FONTS as f (f.family)}
                  <button
                    type="button"
                    class="chip"
                    data-font={f.family}
                    style:font-family={f.family}
                    aria-pressed={!t.font_asset && (t.font ?? 'IBM Plex Sans') === f.family}
                    onclick={() => textPatch({ font: f.family, font_asset: null }, 'Font')}
                    {@attach tooltip(f.family)}>{f.label}</button
                  >
                {/each}
                {#each fontAssets as a (a.id)}
                  <button
                    type="button"
                    class="chip"
                    data-font-asset={a.id}
                    aria-pressed={t.font_asset === a.id}
                    onclick={() => textPatch({ font_asset: a.id }, 'Font')}>{a.name}</button
                  >
                {/each}
              </div>
              <div class="inline">
                <label class="size"
                  ><span>Size</span><input
                    type="number"
                    min="4"
                    step="1"
                    value={fontSize(t)}
                    onchange={(e) => textPatch({ font_size: Math.max(4, num(e)) }, 'Text size')}
                  /></label
                >
                <div class="row-tools" role="group" aria-label="Alignment">
                  {#each [['left', 'alignTextLeft'], ['center', 'alignTextCenter'], ['right', 'alignTextRight']] as const as [a, icon] (a)}
                    <button
                      type="button"
                      class="btn ghost icon tiny"
                      data-text-align={a}
                      aria-pressed={(t.align ?? 'center') === a}
                      aria-label="Align text {a}"
                      onclick={() => textPatch({ align: a }, 'Text alignment')}
                      {@attach tooltip(`Align ${a}`)}><Icon name={icon} size={14} /></button
                    >
                  {/each}
                </div>
              </div>
              <Segmented
                value={t.font_weight ?? 400}
                label="Weight"
                options={WEIGHTS}
                onchange={(v: number) => textPatch({ font_weight: v }, 'Text weight')}
              />
              <div class="swatches" role="group" aria-label="Text color">
                {#each TEXT_COLORS as c (c)}
                  <button
                    type="button"
                    class="swatch"
                    data-text-color={c}
                    style:background={c}
                    aria-pressed={(t.color ?? TEXT_DEFAULT_COLOR) === c}
                    aria-label="Text color {c}"
                    onclick={() => textPatch({ color: c }, 'Text color')}
                  ></button>
                {/each}
                <label class="swatch custom" {@attach tooltip('Any color')}>
                  <input
                    type="color"
                    aria-label="Custom text color"
                    value={hexColor(t.color)}
                    oninput={(e) =>
                      textPatch(
                        { color: (e.target as HTMLInputElement).value },
                        'Text color',
                        'text-color',
                      )}
                  />
                </label>
              </div>
              <div class="toggles">
                <button
                  type="button"
                  class="chip"
                  id="text-outline"
                  aria-pressed={!!t.stroke}
                  onclick={() =>
                    textPatch(
                      {
                        stroke: t.stroke ? null : defaultStroke(fontSize(t)),
                      },
                      'Outline',
                    )}>Outline</button
                >
                <button
                  type="button"
                  class="chip"
                  id="text-shadow"
                  aria-pressed={!!t.shadow}
                  onclick={() =>
                    textPatch(
                      {
                        shadow: t.shadow ? null : defaultShadow(fontSize(t)),
                      },
                      'Shadow',
                    )}>Shadow</button
                >
                <button
                  type="button"
                  class="chip"
                  id="text-box"
                  aria-pressed={!!t.box}
                  onclick={() => textPatch({ box: t.box ? null : defaultBox() }, 'Text box')}
                  >Box</button
                >
                <button
                  type="button"
                  class="chip"
                  aria-pressed={!!t.uppercase}
                  onclick={() => textPatch({ uppercase: t.uppercase ? null : true }, 'Capitals')}
                  >AA</button
                >
              </div>
              {#if t.box}
                <div class="swatches" role="group" aria-label="Box color">
                  {#each BOX_COLORS as c (c)}
                    <button
                      type="button"
                      class="swatch"
                      style:background={c}
                      aria-pressed={t.box.color === c}
                      aria-label="Box color {c}"
                      onclick={() => textPatch({ box: { ...t.box!, color: c } }, 'Box color')}
                    ></button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}

          {#if single && layerKind(single) !== 'slot'}
            <label class="block">
              <span>Opacity</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={single.opacity ?? 1}
                style:--fill="{(single.opacity ?? 1) * 100}%"
                aria-valuetext="{Math.round((single.opacity ?? 1) * 100)}%"
                oninput={(e) =>
                  patchOne(
                    single.id,
                    { opacity: num(e) === 1 ? null : num(e) },
                    'Change opacity',
                    `${single.id}:opacity`,
                  )}
              />
            </label>
          {/if}

          {#if single && layerKind(single) === 'image' && !single.slot}
            <details class="group" open={!!single.crop}>
              <summary>Crop <span class="muted">(source pixels)</span></summary>
              <div class="grid2">
                <label
                  ><span>Left</span><input
                    type="number"
                    min="0"
                    value={crop?.x}
                    onchange={(e) => setCrop('x', num(e))}
                  /></label
                >
                <label
                  ><span>Top</span><input
                    type="number"
                    min="0"
                    value={crop?.y}
                    onchange={(e) => setCrop('y', num(e))}
                  /></label
                >
                <label
                  ><span>Width</span><input
                    type="number"
                    min="1"
                    value={crop?.width}
                    onchange={(e) => setCrop('width', num(e))}
                  /></label
                >
                <label
                  ><span>Height</span><input
                    type="number"
                    min="1"
                    value={crop?.height}
                    onchange={(e) => setCrop('height', num(e))}
                  /></label
                >
              </div>
              {#if single.crop}<button
                  type="button"
                  class="btn small ghost"
                  onclick={() =>
                    patchOne(single.id, { crop: null, width: null, height: null }, 'Reset crop')}
                  >Reset crop</button
                >{/if}
            </details>
          {/if}
          {#if single && layerKind(single) === 'image'}
            <details class="group" open={!!single.filters?.length}>
              <summary>Filters</summary>
              {#each FILTERS as f (f.type)}
                <label class="slider" data-filter={f.type}>
                  <span>{f.label} <span class="mono muted">{filterValue(f.type)}</span></span>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={filterValue(f.type)}
                    style:--fill="{((Number(filterValue(f.type)) - f.min) / (f.max - f.min)) *
                      100}%"
                    oninput={(e) => setFilter(f.type, num(e))}
                    ondblclick={() => setFilter(f.type, null)}
                  />
                </label>
              {/each}
              {#if single.filters?.length}
                <button
                  type="button"
                  class="btn small ghost"
                  onclick={() => patchOne(single.id, { filters: null }, 'Clear filters')}
                  >Clear filters</button
                >
              {/if}
            </details>
          {/if}
        </section>
      {/if}

      {#if editable && imageAssets.length}
        <section class="library" aria-label="Images" data-tour="canvas-library">
          <h2>Images <span class="muted">drag onto the frame or a slot</span></h2>
          <ul>
            {#each imageAssets as a (a.id)}
              {@const thumb = a.kind === 'image' ? a.src : a.poster}
              <li>
                <!-- role=button span: Chromium does not drag from <button> -->
                <span
                  role="button"
                  tabindex="0"
                  class="lib-item"
                  draggable="true"
                  data-asset-id={a.id}
                  aria-label="Add {a.name} as a layer"
                  ondragstart={(e) => {
                    e.dataTransfer?.setData('application/x-sbd-asset', a.id);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onclick={() => {
                    const slot = single && layerKind(single) === 'slot' ? single : null;
                    if (slot) fill(slot.id, a.id);
                    else addLayerFrom(a.id);
                  }}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      const slot = single && layerKind(single) === 'slot' ? single : null;
                      if (slot) fill(slot.id, a.id);
                      else addLayerFrom(a.id);
                    }
                  }}
                  {@attach tooltip(
                    `${a.name}: click to add (or to fill the selected slot), or drag`,
                  )}
                >
                  {#if thumb && app.mediaUrl(thumb)}<img
                      src={app.mediaUrl(thumb)}
                      alt=""
                      draggable="false"
                    />{:else}<Icon name="film" size={16} />{/if}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {:else}
      <h2>Layers</h2>
      <p class="muted empty">—</p>
    {/if}
  </aside>
</div>

<AssetPicker
  bind:open={picker}
  kinds={['image', 'video']}
  title="Add a layer"
  onPick={(id) => addLayerFrom(id)}
/>
{#if layoutPicker}
  <LayoutPicker bind:open={layoutOpen} {size} mode={layoutPicker.mode} onPick={onLayout} />
{/if}

<style>
  .canvas-view {
    display: grid;
    grid-template-columns: 200px 1fr 280px;
    height: 100%;
    min-height: 0;
  }
  .shots,
  .side {
    overflow: auto;
    padding: var(--space-3);
    background: var(--surface);
  }
  .shots {
    border-right: 1px solid var(--border);
  }
  .side {
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .shots button,
  .layer-list .name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 6px var(--space-2);
    font: inherit;
    font-size: 13px;
    color: var(--fg-2);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius);
    cursor: pointer;
    min-width: 0;
  }
  .layer-list .name {
    padding-left: 2px;
  }
  .shots button:hover,
  .layer-list li:hover {
    background: var(--surface-2);
  }
  .shots button[aria-current='true'],
  .layer-list li.selected {
    background: var(--accent-soft);
    color: var(--fg);
  }
  .layer-list li {
    display: flex;
    align-items: center;
    border-radius: var(--radius);
    border-top: 2px solid transparent;
    border-bottom: 2px solid transparent;
  }
  .layer-list li.grouped {
    margin-left: 14px;
  }
  .layer-list li.drop-before {
    border-top-color: var(--accent);
  }
  .layer-list li.drop-after {
    border-bottom-color: var(--accent);
  }
  .layer-list li.group-head .name {
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .layer-list li.hidden-layer .t {
    color: var(--fg-muted);
    text-decoration: line-through;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 14px;
    flex: none;
    color: var(--fg-faint);
    cursor: grab;
    opacity: 0;
  }
  .layer-list li:hover .grip {
    opacity: 1;
  }
  .layer-list .tiny {
    opacity: 0;
  }
  .layer-list li:hover .tiny,
  .layer-list li:focus-within .tiny,
  .layer-list li.selected .tiny,
  .layer-list .tiny[aria-pressed='true'],
  .layer-list .tiny:focus-visible {
    opacity: 1;
  }
  .layer-list .del:hover {
    color: var(--danger);
  }
  .rename {
    flex: 1;
    min-width: 0;
    margin: 2px;
    font: inherit;
    font-size: 13px;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--focus);
    border-radius: var(--radius-sm);
    padding: 3px 6px;
  }
  .num {
    color: var(--accent-text);
    font-size: 11px;
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    font-size: 10px;
    color: var(--fg-muted);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-2);
    min-width: 0;
    min-height: 0;
  }
  .variant-tabs,
  .toolbar,
  .tool-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .toolbar {
    gap: var(--space-3);
  }
  .tool-group {
    gap: 2px;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 8px;
    font: inherit;
    font-size: 12.5px;
    color: var(--fg-2);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
    white-space: nowrap;
  }
  .tool:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .tool[aria-pressed='true'] {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .tool:disabled {
    opacity: 0.4;
  }
  .tool.icon-only {
    padding: 0 5px;
  }
  .phone {
    display: inline-flex;
    margin-left: 6px;
    color: var(--fg-muted);
  }
  .tool.slim {
    padding: 0 6px;
  }
  .zoom-level {
    min-width: 46px;
    justify-content: center;
    font-size: 11.5px;
  }
  .chip.add {
    border-style: dashed;
    color: var(--fg-muted);
  }
  .hint-strip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 4px 8px;
    font-size: 12px;
    color: var(--fg-2);
    background: var(--surface-2);
    border-radius: var(--radius);
  }
  .hint-strip span {
    flex: 1;
  }
  .stage-host {
    position: relative;
    flex: 1;
    min-height: 240px;
    display: grid;
    place-items: center;
    background: repeating-conic-gradient(var(--surface-2) 0 25%, var(--bg) 0 50%) 0 0 / 20px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .stage-host.dropping {
    outline: 2px dashed var(--accent);
    outline-offset: -4px;
  }
  .stage {
    position: absolute;
    inset: 0;
    line-height: 0;
    outline: none;
  }
  .stage:focus-visible {
    box-shadow: inset 0 0 0 2px var(--focus);
  }
  .text-editor {
    position: absolute;
    z-index: 2;
    margin: 0;
    border: 1px dashed var(--canvas-handle);
    background: var(--overlay-bg);
    resize: none;
    overflow: hidden;
    transform-origin: 0 0;
    outline: none;
  }
  .single {
    height: calc(100% - 24px);
    max-width: calc(100% - 24px);
    max-height: 100%;
  }
  .status-line {
    margin: 0;
    min-height: 16px;
    font-size: 11.5px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
  }
  .link {
    font: inherit;
    color: var(--accent-text);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
  }
  .side h2 {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
    margin: var(--space-1) var(--space-2) 0;
  }
  .side h2 .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  .empty {
    margin: 0 var(--space-2);
    font-size: 12px;
  }
  .props {
    border-top: 1px solid var(--border);
    padding: var(--space-2) var(--space-1) 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .row-tools.text .btn {
    flex: 1;
    justify-content: center;
    gap: 4px;
  }
  .btn.tiny {
    width: 26px;
    height: 26px;
    padding: 5px;
    flex: none;
  }
  .btn.small {
    padding: 3px 10px;
    font-size: 12px;
  }
  .btn.tiny[aria-pressed='true'] {
    color: var(--accent-text);
  }
  .arrange,
  .slot-props,
  .text-props {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .grid4 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 6px;
    align-items: end;
  }
  .grid4 .rot {
    grid-column: span 2;
  }
  .grid4 .ratio {
    justify-self: start;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--fg-muted);
    min-width: 0;
  }
  label.block {
    width: 100%;
  }
  input[type='number'],
  textarea:not(.text-editor) {
    font: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 3px 6px;
    min-width: 0;
    width: 100%;
  }
  input:disabled {
    opacity: 0.5;
  }
  input[type='range'] {
    width: 100%;
  }
  .chips,
  .toggles,
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chips .chip,
  .toggles .chip {
    font-size: 11.5px;
    padding: 2px 8px;
  }
  .chip[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .inline {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .inline .size {
    width: 72px;
  }
  .swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    cursor: pointer;
  }
  .swatch[aria-pressed='true'] {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .swatch.custom {
    position: relative;
    overflow: hidden;
    background: conic-gradient(
      var(--shot-1),
      var(--shot-2),
      var(--shot-3),
      var(--shot-4),
      var(--shot-5),
      var(--shot-6),
      var(--shot-1)
    );
  }
  .swatch.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .group summary {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-2);
    cursor: pointer;
    padding: 2px 0;
  }
  .group[open] summary {
    margin-bottom: var(--space-2);
  }
  .slider span {
    display: flex;
    justify-content: space-between;
  }
  .library {
    border-top: 1px solid var(--border);
    padding-top: var(--space-2);
    margin-top: auto;
  }
  .library ul {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .lib-item {
    display: grid;
    place-items: center;
    width: 100%;
    height: 56px;
    padding: 2px;
    background: repeating-conic-gradient(var(--surface-2) 0 25%, var(--surface) 0 50%) 0 0 / 10px
      10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: grab;
    color: var(--fg-muted);
  }
  .lib-item:hover,
  .lib-item:focus-visible {
    border-color: var(--accent);
  }
  .library img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  @media (max-width: 960px) {
    .canvas-view {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr auto;
    }
    .shots,
    .side {
      border: 0;
      max-height: 220px;
    }
  }
</style>
