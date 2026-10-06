<script lang="ts">
  import type { Asset } from '@storyboard-viewer/format';
  import { mediaSrc } from '../lib/hls';
  import { app } from '../lib/state.svelte';

  let {
    asset,
    alt = '',
    controls = false,
    fit = 'contain',
  }: {
    asset: Asset | undefined;
    alt?: string;
    controls?: boolean;
    fit?: 'contain' | 'cover';
  } = $props();

  const url = $derived(asset ? app.mediaUrl(asset.src) : null);
  const poster = $derived(asset?.poster ? app.mediaUrl(asset.poster) : null);
  const reason = $derived(
    !asset ? 'Missing asset' : url ? null : (app.media?.reason(asset.src) ?? 'Not available'),
  );
</script>

{#if !asset || !url}
  <div class="empty-media" role="img" aria-label={alt || reason}>{reason}</div>
{:else if asset.kind === 'image'}
  <img src={url} {alt} style:object-fit={fit} draggable="false" />
{:else if asset.kind === 'video'}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    use:mediaSrc={url}
    poster={poster ?? undefined}
    style:object-fit={fit}
    muted={!controls}
    {controls}
    loop={!controls}
    playsinline
    preload="metadata"
    aria-label={alt}
  ></video>
{:else if asset.kind === 'audio'}
  <audio use:mediaSrc={url} controls preload="metadata" aria-label={alt}></audio>
{:else}
  <div class="empty-media">{asset.name}</div>
{/if}

<style>
  img,
  video {
    display: block;
    width: 100%;
    height: 100%;
  }
  audio {
    width: 100%;
  }
</style>
