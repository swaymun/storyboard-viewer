<script lang="ts">
  // Picks a canvas layout (for the frame's shape): a small drawing of each layout's slots and
  // text, its name and what it is for. "Blank" starts an empty canvas (new canvases only).
  import { layoutsFor, type LayoutDef } from '@storyboard-viewer/format';
  import Dialog from './Dialog.svelte';

  let {
    open = $bindable(false),
    size,
    mode,
    onPick,
  }: {
    open: boolean;
    size: { width: number; height: number };
    /** `new`: start a canvas (Blank offered); `apply`: re-arrange the current one. */
    mode: 'new' | 'apply';
    onPick: (layout: LayoutDef | null) => void;
  } = $props();

  const layouts = $derived(layoutsFor(size.width, size.height));
  const ratio = $derived(`${size.width} / ${size.height}`);
  const pct = (n: number) => `${n * 100}%`;

  function pick(l: LayoutDef | null) {
    open = false;
    onPick(l);
  }
</script>

<Dialog
  bind:open
  title={mode === 'new' ? 'Start with a layout' : 'Apply a layout'}
  id="layout-picker"
  width={720}
>
  <p class="muted intro">
    {#if mode === 'new'}
      Layouts place named slots for your pictures. Drop an image on a slot to fill it.
    {:else}
      Your pictures move into the slots (largest first); text stays where it is.
    {/if}
  </p>
  <ul class="grid" class:tall={size.height > size.width}>
    {#if mode === 'new'}
      <li>
        <button type="button" class="card" data-layout="blank" onclick={() => pick(null)}>
          <span class="thumb" style:aspect-ratio={ratio}></span>
          <span class="name">Blank</span>
          <span class="desc muted">An empty canvas</span>
        </button>
      </li>
    {/if}
    {#each layouts as l (l.id)}
      <li>
        <button type="button" class="card" data-layout={l.id} onclick={() => pick(l)}>
          <span
            class="thumb"
            class:dark={!!l.background}
            style:aspect-ratio={ratio}
            aria-hidden="true"
          >
            {#each l.slots as s (s.name)}
              <span
                class="slot"
                style:left={pct(s.x)}
                style:top={pct(s.y)}
                style:width={pct(s.w)}
                style:height={pct(s.h)}><span>{s.name}</span></span
              >
            {/each}
            {#each l.texts ?? [] as t (t.name)}
              <span class="text" style:left={pct(t.x)} style:top={pct(t.y)} style:width={pct(t.w)}
                >Aa</span
              >
            {/each}
          </span>
          <span class="name">{l.name}</span>
          <span class="desc muted">{l.description}</span>
        </button>
      </li>
    {/each}
  </ul>
</Dialog>

<style>
  .intro {
    margin: 0 0 12px;
    font-size: 13px;
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }
  .grid.tall {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 8px;
    font: inherit;
    text-align: left;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    cursor: pointer;
  }
  .card:hover,
  .card:focus-visible {
    border-color: var(--accent);
  }
  .thumb {
    position: relative;
    display: block;
    width: 100%;
    max-height: 200px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .thumb.dark {
    background: var(--stage);
  }
  .slot {
    position: absolute;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    outline: 1px dashed var(--accent);
    outline-offset: -2px;
    font-size: 9px;
    color: var(--fg-2);
    overflow: hidden;
  }
  .slot span {
    padding: 0 2px;
    background: var(--surface);
    border-radius: var(--radius-sm);
  }
  .text {
    position: absolute;
    font-size: 10px;
    font-weight: 700;
    text-align: center;
    color: var(--overlay-fg);
    background: var(--overlay-bg);
    border-radius: var(--radius-sm);
  }
  .name {
    font-size: 13px;
    font-weight: 600;
  }
  .desc {
    font-size: 11.5px;
    line-height: 1.35;
  }
</style>
