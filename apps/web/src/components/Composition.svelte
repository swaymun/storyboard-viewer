<script lang="ts">
  // DOM/CSS render of a canvas variant (cards, thumbnails, print view, animatic stage). The
  // Canvas tab uses Konva. Text layers are drawn with the same canvas routine as the editor and
  // the video export (lib/text-render.ts); empty layout slots are editor-only and not drawn.
  import { layerKind, type CanvasVariant, type Layer } from '@storyboard-viewer/format';
  import { mediaSrc } from '../lib/hls';
  import { app } from '../lib/state.svelte';
  import { drawText, loadTextFonts, measureText, textBleed } from '../lib/text-render';
  import { canvasSize, cssFilter } from '../lib/visual';

  let { variant }: { variant: CanvasVariant } = $props();
  const size = $derived(canvasSize(variant, app.project?.manifest));
  const u = (px: number) => `calc(${px} * 100cqw / ${size.width})`;
  interface Common {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    name: string;
    transform: string;
    opacity: number;
  }
  type Item =
    | (Common & { kind: 'text'; layer: Layer; bleed: { x: number; y: number } })
    | (Common & {
        kind: 'image';
        url: string | null;
        media: string | undefined;
        img: { left: number; top: number; width: number; height: number };
        filter: string;
      });
  const layers = $derived(
    variant.layers
      .filter((l) => l.visible !== false)
      .flatMap((l): Item[] => {
        const kind = layerKind(l);
        const common = {
          id: l.id,
          x: l.x ?? 0,
          y: l.y ?? 0,
          transform: `rotate(${l.rotation ?? 0}deg) scale(${l.scale_x ?? 1}, ${l.scale_y ?? 1})`,
          opacity: l.opacity ?? 1,
        };
        if (kind === 'text') {
          const m = measureText(l);
          const b = textBleed(l);
          return [
            {
              ...common,
              kind: 'text' as const,
              layer: l,
              name: l.text ?? '',
              w: m.width,
              h: m.height,
              bleed: { x: (b / m.width) * 100, y: (b / Math.max(1, m.height)) * 100 },
            },
          ];
        }
        if (kind !== 'image') return [];
        const asset = l.asset ? app.assets.get(l.asset) : undefined;
        const crop = l.crop;
        const srcW = crop?.width ?? asset?.width ?? size.width;
        const srcH = crop?.height ?? asset?.height ?? size.height;
        const w = l.width ?? srcW;
        const h = l.height ?? srcH;
        const kx = w / srcW;
        const ky = h / srcH;
        return [
          {
            ...common,
            kind: 'image' as const,
            name: l.name ?? asset?.name ?? l.asset ?? '',
            url: asset ? app.mediaUrl(asset.src) : null,
            media: asset?.kind,
            w,
            h,
            img: {
              left: -(crop?.x ?? 0) * kx,
              top: -(crop?.y ?? 0) * ky,
              width: (asset?.width ?? srcW) * kx,
              height: (asset?.height ?? srcH) * ky,
            },
            filter: cssFilter(l.filters, u),
          },
        ];
      }),
  );

  /**
   * Draws a text layer into its own canvas (2× the frame pixels, sharp in print too), with room
   * around the box for the outline and shadow. `data-fonts="loaded"` once drawn with its fonts
   * (the print view waits for it).
   */
  function textCanvas(layer: Layer) {
    return (el: HTMLCanvasElement) => {
      let alive = true;
      const draw = () => {
        if (!alive) return;
        const m = measureText(layer);
        const b = textBleed(layer);
        const k = Math.min(2, 4096 / Math.max(m.width + 2 * b, m.height + 2 * b, 1));
        el.width = Math.max(1, Math.ceil((m.width + 2 * b) * k));
        el.height = Math.max(1, Math.ceil((m.height + 2 * b) * k));
        const ctx = el.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(k, 0, 0, k, b * k, b * k);
        drawText(ctx, layer, m);
      };
      draw();
      void loadTextFonts([layer], app.assets, (s) => app.mediaUrl(s)).then(() => {
        draw();
        el.dataset['fonts'] = 'loaded';
      });
      return () => {
        alive = false;
      };
    };
  }
</script>

<div
  class="composition"
  style:aspect-ratio="{size.width} / {size.height}"
  style:background={variant.background ?? 'transparent'}
  role="img"
  aria-label="Composition: {layers.map((l) => l.name).join(', ')}"
>
  {#each layers as l (l.id)}
    <div
      class="layer"
      class:text={l.kind === 'text'}
      data-layer-id={l.id}
      style:left={u(l.x)}
      style:top={u(l.y)}
      style:width={u(l.w)}
      style:height={u(l.h)}
      style:transform={l.transform}
      style:opacity={l.opacity}
      style:filter={l.kind === 'image' ? l.filter : undefined}
    >
      {#if l.kind === 'text'}
        {#key l.layer}
          <canvas
            class="text-canvas"
            aria-hidden="true"
            style:left="-{l.bleed.x}%"
            style:top="-{l.bleed.y}%"
            style:width="{100 + 2 * l.bleed.x}%"
            style:height="{100 + 2 * l.bleed.y}%"
            {@attach textCanvas(l.layer)}
          ></canvas>
        {/key}
        <span class="visually-hidden">{l.name}</span>
      {:else if l.url && l.media === 'video'}
        <video
          use:mediaSrc={l.url}
          muted
          loop
          playsinline
          style:left={u(l.img.left)}
          style:top={u(l.img.top)}
          style:width={u(l.img.width)}
          style:height={u(l.img.height)}
        ></video>
      {:else if l.url}
        <img
          src={l.url}
          alt=""
          draggable="false"
          style:left={u(l.img.left)}
          style:top={u(l.img.top)}
          style:width={u(l.img.width)}
          style:height={u(l.img.height)}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  .composition {
    position: relative;
    width: 100%;
    overflow: hidden;
    container-type: inline-size;
  }
  .layer {
    position: absolute;
    transform-origin: 0 0;
    overflow: hidden;
  }
  .layer.text {
    overflow: visible;
  }
  .layer img,
  .layer video {
    position: absolute;
    max-width: none;
  }
  .text-canvas {
    position: absolute;
  }
</style>
