<script lang="ts">
  // DOM/CSS render of a canvas variant (cards and thumbnails). The Canvas tab uses Konva.
  import type { CanvasVariant } from '@storyboard-viewer/format';
  import { mediaSrc } from '../lib/hls';
  import { app } from '../lib/state.svelte';
  import { canvasSize, cssFilter } from '../lib/visual';

  let { variant }: { variant: CanvasVariant } = $props();
  const size = $derived(canvasSize(variant, app.project?.manifest));
  const layers = $derived(
    variant.layers
      .filter((l) => l.visible !== false)
      .map((l) => {
        const asset = app.assets.get(l.asset);
        const crop = l.crop;
        const srcW = crop?.width ?? asset?.width ?? size.width;
        const srcH = crop?.height ?? asset?.height ?? size.height;
        const w = l.width ?? srcW;
        const h = l.height ?? srcH;
        const kx = w / srcW;
        const ky = h / srcH;
        return {
          id: l.id,
          name: l.name ?? asset?.name ?? l.asset,
          url: asset ? app.mediaUrl(asset.src) : null,
          kind: asset?.kind,
          x: l.x ?? 0,
          y: l.y ?? 0,
          w,
          h,
          img: {
            left: -(crop?.x ?? 0) * kx,
            top: -(crop?.y ?? 0) * ky,
            width: (asset?.width ?? srcW) * kx,
            height: (asset?.height ?? srcH) * ky,
          },
          transform: `rotate(${l.rotation ?? 0}deg) scale(${l.scale_x ?? 1}, ${l.scale_y ?? 1})`,
          opacity: l.opacity ?? 1,
          filter: cssFilter(l.filters, (px) => `calc(${px} * 100cqw / ${size.width})`),
        };
      }),
  );
  const u = (px: number) => `calc(${px} * 100cqw / ${size.width})`;
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
      data-layer-id={l.id}
      style:left={u(l.x)}
      style:top={u(l.y)}
      style:width={u(l.w)}
      style:height={u(l.h)}
      style:transform={l.transform}
      style:opacity={l.opacity}
      style:filter={l.filter}
    >
      {#if l.url && l.kind === 'video'}
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
  .layer img,
  .layer video {
    position: absolute;
    max-width: none;
  }
</style>
