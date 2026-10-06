<script lang="ts">
  import type { Variant } from '@storyboard-viewer/format';
  import { app } from '../lib/state.svelte';
  import { frameAspect } from '../lib/visual';
  import Composition from './Composition.svelte';
  import MediaView from './MediaView.svelte';

  let { variant, label }: { variant: Variant | undefined; label: string } = $props();
</script>

<div class="frame" style:aspect-ratio={frameAspect(app.project?.manifest)}>
  {#if !variant}
    <div class="empty-media">No image yet</div>
  {:else if variant.type === 'image'}
    <MediaView asset={app.assets.get(variant.asset)} alt={label} />
  {:else if variant.type === 'canvas'}
    <div class="center"><Composition {variant} /></div>
  {:else}
    <div class="empty-media">Unsupported variant</div>
  {/if}
</div>

<style>
  .frame {
    position: relative;
    width: 100%;
    background: var(--stage);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .center {
    position: absolute;
    inset: 0;
    display: grid;
    align-items: center;
  }
</style>
