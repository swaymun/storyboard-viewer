<script lang="ts">
  import {
    KNOWN_FILTERS,
    addAsset,
    addLayer,
    addVariant,
    assetReferences,
    duplicateLayer,
    moveLayer,
    removeLayer,
    updateAsset,
    updateLayer,
    updateVariant,
    type CanvasVariant,
    type Layer,
    type LayerFilter,
    type SbdProject,
    type Variant,
  } from '@storyboard-viewer/format';
  import { onDestroy } from 'svelte';
  import { theme } from '../lib/theme.svelte';
  import { createEditor, type EditorHandle, type EditorInput } from '../lib/konva-editor';
  import { app } from '../lib/state.svelte';
  import { canvasSize, frameAspect } from '../lib/visual';
  import AssetPicker from './AssetPicker.svelte';
  import Icon from './Icon.svelte';
  import VariantView from './VariantView.svelte';

  const shotId = $derived(app.selectedShot ?? app.shots[0]?.ref.id ?? null);
  const entry = $derived(app.shots.find((s) => s.ref.id === shotId));
  const shot = $derived(entry?.shot);
  const variant = $derived<Variant | undefined>(shot ? app.shownVariant(shot) : undefined);
  const canvas = $derived(variant?.type === 'canvas' ? (variant as CanvasVariant) : null);
  const size = $derived(
    canvas ? canvasSize(canvas, app.project?.manifest) : { width: 1920, height: 1080 },
  );
  let selectedLayer = $state<string | null>(null);
  const layer = $derived(canvas?.layers.find((l) => l.id === selectedLayer) ?? null);
  const editable = $derived(app.canEdit);

  let guides = $state(true);
  let snapping = $state(true);
  let picker = $state(false);
  let renaming = $state<string | null>(null);
  let dropping = $state(false);
  let flattening = $state(false);

  let host = $state<HTMLDivElement>();
  let stageEl = $state<HTMLDivElement>();
  let handle: EditorHandle | null = null;
  let creating = false;

  // Selection follows the variant: forget it when the layer disappears.
  $effect(() => {
    if (selectedLayer && !canvas?.layers.some((l) => l.id === selectedLayer)) selectedLayer = null;
  });

  $effect(() => {
    const el = stageEl;
    const input: EditorInput | null = canvas
      ? {
          variant: canvas,
          size,
          assets: app.assets,
          url: (src: string) => app.mediaUrl(src),
          selectedLayer,
          editable,
          guides,
          snapping,
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
        onSelect: (id) => (selectedLayer = id),
        onCommit: (id, patch, label) => commitLayer(id, patch, label),
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

  // Theme switch: handles, mask and guides are drawn in theme colors.
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

  function commitLayer(
    id: string,
    patch: Partial<Layer> | Record<string, unknown>,
    label: string,
    coalesce?: string,
  ) {
    if (!shot || !canvas) return;
    const { s, v } = ids();
    app.edit(label, (p) => updateLayer(p, s, v, id, patch as never), coalesce ? { coalesce } : {});
  }

  function natSize(assetId: string) {
    const a = app.assets.get(assetId);
    return { w: a?.width ?? size.width / 2, h: a?.height ?? size.height / 2 };
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
      selectedLayer = id;
  }

  function newCanvas(fromImage?: string) {
    if (!shot) return;
    const sid = shot.id;
    let vid = '';
    const ok = app.edit(fromImage ? 'Convert to canvas' : 'Add canvas variant', (p) => {
      const layers: Layer[] = [];
      const manifestSize = canvasSize({ id: 'x', type: 'canvas', layers: [] }, p.manifest);
      if (fromImage) {
        const a = p.assets.assets.find((x) => x.id === fromImage);
        const w = a?.width ?? manifestSize.width;
        const h = a?.height ?? manifestSize.height;
        const k = Math.max(manifestSize.width / w, manifestSize.height / h);
        layers.push({
          id: 'ly_base',
          asset: fromImage,
          x: Math.round((manifestSize.width - w * k) / 2),
          y: Math.round((manifestSize.height - h * k) / 2),
          scale_x: Math.round(k * 1e4) / 1e4,
          scale_y: Math.round(k * 1e4) / 1e4,
        });
      }
      const r = addVariant(
        p,
        sid,
        {
          type: 'canvas',
          name: fromImage ? `${variant?.name ?? 'Image'} layout` : 'Layout',
          layers,
        },
        { activate: true },
      );
      vid = r.id;
      return r;
    });
    if (ok) app.chooseVariant(app.project!.shots[sid]!, vid);
  }

  function zMove(id: string, to: number) {
    const { s, v } = ids();
    app.edit(
      to > canvas!.layers.findIndex((l) => l.id === id) ? 'Bring forward' : 'Send backward',
      (p) => moveLayer(p, s, v, id, to),
    );
  }

  function deleteLayer(id: string) {
    const { s, v } = ids();
    if (app.edit('Delete layer', (p) => removeLayer(p, s, v, id))) selectedLayer = null;
  }

  function dupLayer(id: string) {
    const { s, v } = ids();
    let nid = '';
    if (
      app.edit('Duplicate layer', (p) => {
        const r = duplicateLayer(p, s, v, id);
        nid = r.id;
        return r;
      })
    )
      selectedLayer = nid;
  }

  function setFilter(type: string, value: number | null) {
    if (!layer) return;
    const def = FILTER_DEFAULTS[type] ?? 0;
    const others = (layer.filters ?? []).filter((f) => f.type !== type);
    const filters: LayerFilter[] =
      value === null || Math.abs(value - def) < 1e-6 ? others : [...others, { type, value }];
    filters.sort(
      (a, b) => KNOWN_FILTERS.indexOf(a.type as never) - KNOWN_FILTERS.indexOf(b.type as never),
    );
    commitLayer(
      layer.id,
      { filters: filters.length ? filters : null },
      'Adjust filter',
      `${layer.id}:filter:${type}`,
    );
  }
  const filterValue = (type: string) =>
    layer?.filters?.find((f) => f.type === type)?.value ?? FILTER_DEFAULTS[type] ?? 0;

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
    if (!layer) return;
    const nat = natSize(layer.asset);
    const old = layer.crop ?? { x: 0, y: 0, width: nat.w, height: nat.h };
    const crop = { ...old, [key]: Math.max(key === 'x' || key === 'y' ? 0 : 1, Math.round(value)) };
    // keep the on-screen scale: display size follows the crop size
    const kx = (layer.width ?? old.width) / old.width;
    const ky = (layer.height ?? old.height) / old.height;
    const patch: Record<string, unknown> = { crop };
    if (layer.width !== undefined) patch['width'] = Math.round(crop.width * kx * 100) / 100;
    if (layer.height !== undefined) patch['height'] = Math.round(crop.height * ky * 100) / 100;
    commitLayer(layer.id, patch, 'Crop layer', `${layer.id}:crop`);
  }

  function resetCrop() {
    if (layer) commitLayer(layer.id, { crop: null, width: null, height: null }, 'Reset crop');
  }

  function fit(mode: 'fit' | 'fill' | 'center') {
    if (!layer) return;
    const nat = natSize(layer.asset);
    const w = layer.width ?? layer.crop?.width ?? nat.w;
    const h = layer.height ?? layer.crop?.height ?? nat.h;
    let sx = layer.scale_x ?? 1;
    let sy = layer.scale_y ?? 1;
    if (mode !== 'center') {
      const k = (mode === 'fit' ? Math.min : Math.max)(size.width / w, size.height / h);
      sx = Math.sign(sx || 1) * k;
      sy = Math.sign(sy || 1) * k;
    }
    commitLayer(
      layer.id,
      {
        scale_x: Math.round(sx * 1e4) / 1e4,
        scale_y: Math.round(sy * 1e4) / 1e4,
        rotation: mode === 'center' ? (layer.rotation ?? 0) : 0,
        x: Math.round((size.width - w * Math.abs(sx)) / 2),
        y: Math.round((size.height - h * Math.abs(sy)) / 2),
      },
      mode === 'center' ? 'Center layer' : mode === 'fit' ? 'Fit layer' : 'Fill frame',
    );
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

  // --- keyboard on the stage
  function onStageKey(e: KeyboardEvent) {
    if (!layer || !editable) return;
    const step = e.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = nudge[e.key];
    const i = canvas!.layers.findIndex((l) => l.id === layer.id);
    if (d && !layer.locked) {
      e.preventDefault();
      commitLayer(
        layer.id,
        {
          x: Math.round(((layer.x ?? 0) + d[0]) * 100) / 100,
          y: Math.round(((layer.y ?? 0) + d[1]) * 100) / 100,
        },
        'Nudge layer',
        `${layer.id}:nudge`,
      );
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteLayer(layer.id);
    } else if (e.key === ']') zMove(layer.id, i + 1);
    else if (e.key === '[') zMove(layer.id, Math.max(0, i - 1));
    else if (e.key === 'Escape') selectedLayer = null;
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      dupLayer(layer.id);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    if (!canvas || !handle || !editable) return;
    const at = handle.toCanvasPoint(e.clientX, e.clientY);
    const assetId = e.dataTransfer?.getData('application/x-sbd-asset');
    if (assetId) {
      addLayerFrom(assetId, at);
      return;
    }
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /^(image|video)\//.test(f.type));
    if (files.length)
      void app.importFiles(files).then((added) => added.forEach((id) => addLayerFrom(id, at)));
  }

  const layerName = (l: Layer) => l.name ?? app.assets.get(l.asset)?.name ?? l.asset;
  const imageAssets = $derived(
    (app.project?.assets.assets ?? []).filter((a) => a.kind === 'image' || a.kind === 'video'),
  );
  const crop = $derived(
    layer
      ? (layer.crop ?? {
          x: 0,
          y: 0,
          width: natSize(layer.asset).w,
          height: natSize(layer.asset).h,
        })
      : null,
  );
  const num = (e: Event) => Number((e.target as HTMLInputElement).value);
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
      <div class="toolbar">
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
              onclick={() => newCanvas()}
              title="New empty canvas variant"
            >
              <Icon name="plus" size={12} /> Canvas
            </button>
          {/if}
        </div>
        {#if canvas}
          <div class="tools">
            {#if editable}
              <button
                type="button"
                class="btn small"
                id="add-layer"
                onclick={() => (picker = true)}
              >
                <Icon name="plus" size={14} /> Layer
              </button>
            {/if}
            <button
              type="button"
              class="btn ghost icon"
              aria-pressed={guides}
              aria-label="Safe-area guides"
              title="Safe-area guides"
              onclick={() => (guides = !guides)}><Icon name="frame" /></button
            >
            <button
              type="button"
              class="btn ghost icon"
              aria-pressed={snapping}
              aria-label="Snap to frame and layers"
              title="Snapping"
              onclick={() => (snapping = !snapping)}><Icon name="magnet" /></button
            >
            {#if editable}
              <button
                type="button"
                class="btn small ghost"
                disabled={flattening}
                title="Render this layout to an image saved as the variant's preview"
                onclick={flatten}><Icon name="image" size={14} /> Flatten to preview</button
              >
            {/if}
          </div>
        {/if}
      </div>
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
            aria-label="Canvas editor, {canvas.layers.length} layers{layer
              ? `, ${layerName(layer)} selected. Arrow keys move, Shift for 10 pixels, [ and ] change order, Delete removes`
              : ''}"
            data-variant-id={canvas.id}
            onkeydown={onStageKey}
          ></div>
        {:else}
          <div class="single" style:aspect-ratio={frameAspect(app.project?.manifest)}>
            <VariantView {variant} label={shot.title ?? shot.id} />
          </div>
        {/if}
      </div>
      {#if !canvas && editable}
        <p class="muted hint">
          {#if variant?.type === 'image'}
            This variant is a single image.
            <button
              type="button"
              class="link"
              onclick={() => newCanvas((variant as { asset: string }).asset)}
              >Convert it to a layout</button
            > to arrange layers on top of it.
          {:else}
            No layout yet. <button type="button" class="link" onclick={() => newCanvas()}
              >Create a canvas</button
            >
            to arrange images.
          {/if}
        </p>
      {/if}
    {:else}
      <p class="muted hint">No shots yet.</p>
    {/if}
  </section>

  <aside class="side" aria-label="Layers">
    <h2>Layers</h2>
    {#if canvas}
      <p class="muted size mono">{size.width} × {size.height}</p>
      {#if !canvas.layers.length}
        <p class="muted empty">Drag images onto the frame, or add a layer.</p>
      {/if}
      <ol class="layer-list" reversed>
        {#each canvas.layers.toReversed() as l (l.id)}
          <li class:selected={selectedLayer === l.id} class:hidden-layer={l.visible === false}>
            {#if renaming === l.id}
              <input
                class="rename"
                aria-label="Layer name"
                value={layerName(l)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') renaming = null;
                }}
                onblur={(e) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (renaming === l.id && v && v !== layerName(l))
                    commitLayer(l.id, { name: v }, 'Rename layer');
                  renaming = null;
                }}
                {@attach (el) => (el as HTMLInputElement).select()}
              />
            {:else}
              <button
                type="button"
                class="name"
                data-layer-id={l.id}
                aria-pressed={selectedLayer === l.id}
                ondblclick={() => editable && (renaming = l.id)}
                onclick={() => {
                  selectedLayer = selectedLayer === l.id ? null : l.id;
                  stageEl?.focus();
                }}
              >
                <span class="t">{layerName(l)}</span>
              </button>
            {/if}
            {#if editable}
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="{l.visible === false ? 'Show' : 'Hide'} {layerName(l)}"
                aria-pressed={l.visible === false}
                title={l.visible === false ? 'Show' : 'Hide'}
                onclick={() =>
                  commitLayer(
                    l.id,
                    { visible: l.visible === false ? null : false },
                    l.visible === false ? 'Show layer' : 'Hide layer',
                  )}><Icon name={l.visible === false ? 'eyeOff' : 'eye'} size={14} /></button
              >
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="{l.locked ? 'Unlock' : 'Lock'} {layerName(l)}"
                aria-pressed={!!l.locked}
                title={l.locked ? 'Unlock' : 'Lock'}
                onclick={() =>
                  commitLayer(
                    l.id,
                    { locked: l.locked ? null : true },
                    l.locked ? 'Unlock layer' : 'Lock layer',
                  )}><Icon name={l.locked ? 'lock' : 'unlock'} size={14} /></button
              >
            {/if}
          </li>
        {/each}
      </ol>

      {#if layer}
        <section class="props" aria-label="Layer properties">
          {#if editable}
            <div class="row-tools">
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="Bring forward"
                title="Bring forward (])"
                onclick={() => zMove(layer.id, canvas.layers.indexOf(layer) + 1)}
                ><Icon name="up" size={14} /></button
              >
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="Send backward"
                title="Send backward ([)"
                onclick={() => zMove(layer.id, Math.max(0, canvas.layers.indexOf(layer) - 1))}
                ><Icon name="down" size={14} /></button
              >
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="Rename layer"
                title="Rename"
                onclick={() => (renaming = layer.id)}><Icon name="edit" size={14} /></button
              >
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="Duplicate layer"
                title="Duplicate (⌘D)"
                onclick={() => dupLayer(layer.id)}><Icon name="copy" size={14} /></button
              >
              <button
                type="button"
                class="btn ghost icon tiny"
                aria-label="Delete layer"
                title="Delete"
                onclick={() => deleteLayer(layer.id)}><Icon name="trash" size={14} /></button
              >
            </div>
            <div class="row-tools text">
              <button type="button" class="btn small ghost" onclick={() => fit('fit')}>Fit</button>
              <button type="button" class="btn small ghost" onclick={() => fit('fill')}>Fill</button
              >
              <button type="button" class="btn small ghost" onclick={() => fit('center')}
                >Center</button
              >
            </div>
          {/if}
          <fieldset disabled={!editable}>
            <div class="grid2">
              <label
                ><span>X</span><input
                  type="number"
                  step="1"
                  value={layer.x ?? 0}
                  onchange={(e) => commitLayer(layer.id, { x: num(e) }, 'Move layer')}
                /></label
              >
              <label
                ><span>Y</span><input
                  type="number"
                  step="1"
                  value={layer.y ?? 0}
                  onchange={(e) => commitLayer(layer.id, { y: num(e) }, 'Move layer')}
                /></label
              >
              <label
                ><span>Scale X</span><input
                  type="number"
                  step="0.01"
                  value={layer.scale_x ?? 1}
                  onchange={(e) => commitLayer(layer.id, { scale_x: num(e) }, 'Scale layer')}
                /></label
              >
              <label
                ><span>Scale Y</span><input
                  type="number"
                  step="0.01"
                  value={layer.scale_y ?? 1}
                  onchange={(e) => commitLayer(layer.id, { scale_y: num(e) }, 'Scale layer')}
                /></label
              >
              <label
                ><span>Rotation °</span><input
                  type="number"
                  step="1"
                  value={layer.rotation ?? 0}
                  onchange={(e) => commitLayer(layer.id, { rotation: num(e) }, 'Rotate layer')}
                /></label
              >
              <label>
                <span>Opacity</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={layer.opacity ?? 1}
                  style:--fill="{(layer.opacity ?? 1) * 100}%"
                  aria-valuetext="{Math.round((layer.opacity ?? 1) * 100)}%"
                  oninput={(e) =>
                    commitLayer(
                      layer.id,
                      { opacity: num(e) === 1 ? null : num(e) },
                      'Change opacity',
                      `${layer.id}:opacity`,
                    )}
                />
              </label>
            </div>
            <details class="group" open={!!layer.crop}>
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
              {#if layer.crop}<button type="button" class="btn small ghost" onclick={resetCrop}
                  >Reset crop</button
                >{/if}
            </details>
            <details class="group" open={!!layer.filters?.length}>
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
              {#if layer.filters?.length}
                <button
                  type="button"
                  class="btn small ghost"
                  onclick={() => commitLayer(layer.id, { filters: null }, 'Clear filters')}
                  >Clear filters</button
                >
              {/if}
            </details>
          </fieldset>
        </section>
      {/if}

      {#if editable && imageAssets.length}
        <section class="library" aria-label="Images">
          <h2>Images <span class="muted">drag onto the frame</span></h2>
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
                  title="Add {a.name} as a layer"
                  aria-label="Add {a.name} as a layer"
                  ondragstart={(e) => {
                    e.dataTransfer?.setData('application/x-sbd-asset', a.id);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onclick={() => addLayerFrom(a.id)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      addLayerFrom(a.id);
                    }
                  }}
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
      <p class="muted">—</p>
    {/if}
  </aside>
</div>

<AssetPicker
  bind:open={picker}
  kinds={['image', 'video']}
  title="Add a layer"
  onPick={(id) => addLayerFrom(id)}
/>

<style>
  .canvas-view {
    display: grid;
    grid-template-columns: 200px 1fr 260px;
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
  }
  .layer-list li.hidden-layer .t {
    color: var(--fg-muted);
    text-decoration: line-through;
  }
  .layer-list .tiny {
    opacity: 0;
  }
  .layer-list li:hover .tiny,
  .layer-list li.selected .tiny,
  .layer-list .tiny[aria-pressed='true'],
  .layer-list .tiny:focus-visible {
    opacity: 1;
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
    gap: var(--space-3);
    padding: var(--space-4);
    min-width: 0;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .variant-tabs,
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .tools {
    gap: var(--space-1);
  }
  .tools .btn.icon[aria-pressed='true'] {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .chip.add {
    border-style: dashed;
    color: var(--fg-muted);
  }
  .stage-host {
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
    line-height: 0;
    border-radius: var(--radius);
  }
  .single {
    width: min(100%, 960px);
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
  .size,
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
    gap: 2px;
  }
  .row-tools.text .btn {
    flex: 1;
    justify-content: center;
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
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--fg-muted);
    min-width: 0;
  }
  input[type='number'] {
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
  input[type='range'] {
    width: 100%;
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
