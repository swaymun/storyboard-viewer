<script lang="ts">
  // A shot's picture with its variants as a strip of thumbnails underneath (only when there is
  // more than one). The thumbnail of the picture being shown is outlined; the shot's default
  // variant (active_variant) carries a small dot. ←/→ on the carousel step through variants;
  // the arrows over the picture do the same.
  import type { Shot } from '@storyboard-viewer/format';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import VariantView from './VariantView.svelte';

  /** `strip: false` folds the thumbnail strip away (compact cards); arrows still step. */
  let { shot, label, strip = true }: { shot: Shot; label: string; strip?: boolean } = $props();
  const variants = $derived(shot.variants ?? []);
  const current = $derived(app.shownVariant(shot));
  const defaultId = $derived(shot.active_variant ?? variants[0]?.id);
  const index = $derived(
    Math.max(
      0,
      variants.findIndex((v) => v.id === current?.id),
    ),
  );

  function onkeydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowRight') {
      app.stepVariant(shot, 1);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      app.stepVariant(shot, -1);
      e.preventDefault();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section
  class="carousel"
  id="variants-{shot.id}"
  aria-roledescription="carousel"
  aria-label="Pictures of {label}"
  tabindex={variants.length > 1 ? 0 : -1}
  {onkeydown}
>
  <div
    class="slide"
    role="group"
    aria-roledescription="slide"
    aria-label="{index + 1} of {Math.max(1, variants.length)}{current?.name
      ? `: ${current.name}`
      : ''}"
    data-variant-id={current?.id}
  >
    <VariantView variant={current} label="{label}, {current?.name ?? 'picture'}" />
    {#if variants.length > 1}
      <button
        type="button"
        class="step prev"
        aria-label="Previous variant"
        aria-controls="variants-{shot.id}"
        tabindex="-1"
        onclick={() => app.stepVariant(shot, -1)}><Icon name="prev" size={14} /></button
      >
      <button
        type="button"
        class="step next"
        aria-label="Next variant"
        aria-controls="variants-{shot.id}"
        tabindex="-1"
        onclick={() => app.stepVariant(shot, 1)}><Icon name="next" size={14} /></button
      >
    {/if}
  </div>
  {#if variants.length > 1 && strip}
    <div class="strip" role="group" aria-label="Choose variant">
      {#each variants as v, i (v.id)}
        <button
          type="button"
          class="thumb"
          aria-label="Variant {i + 1}: {v.name ?? v.id}{v.id === defaultId ? ' (default)' : ''}"
          title="{v.name ?? v.id}{v.id === defaultId ? ' · default' : ''}{v.type === 'canvas'
            ? ' · layers'
            : ''}"
          aria-current={v.id === current?.id ? 'true' : undefined}
          data-variant-id={v.id}
          onclick={() => app.chooseVariant(shot, v.id)}
        >
          <VariantView variant={v} label="" />
          {#if v.id === defaultId}<span class="default" aria-hidden="true"></span>{/if}
          {#if v.type === 'canvas'}<span class="kind" aria-hidden="true"
              ><Icon name="layers" size={10} /></span
            >{/if}
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .carousel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-radius: var(--radius);
  }
  .slide {
    position: relative;
  }
  .step {
    position: absolute;
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--overlay-fg);
    background: var(--overlay-bg);
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms var(--ease);
  }
  .step.prev {
    left: 6px;
  }
  .step.next {
    right: 6px;
  }
  .slide:hover .step,
  .carousel:focus-visible .step {
    opacity: 0.9;
  }
  .strip {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 2px;
  }
  .thumb {
    position: relative;
    flex: none;
    width: 46px;
    padding: 0;
    background: none;
    border: 0;
    border-radius: var(--radius);
    outline: 1px solid var(--border);
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 120ms var(--ease);
  }
  .thumb:hover {
    opacity: 1;
  }
  .thumb[aria-current='true'] {
    opacity: 1;
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .thumb:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  .default {
    position: absolute;
    right: 3px;
    top: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 1.5px var(--surface);
  }
  .kind {
    position: absolute;
    left: 2px;
    bottom: 2px;
    display: grid;
    place-items: center;
    color: var(--overlay-fg);
    background: var(--overlay-bg);
    border-radius: var(--radius-sm);
    padding: 1px;
  }
</style>
