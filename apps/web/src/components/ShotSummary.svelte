<script lang="ts">
  // One quiet row that stands for a shot's details, tags and extra versions (pictures) while
  // they are folded away: "7 details · 2 tags · 3 versions". Click or Enter expands them; the
  // choice holds for the rest of the session (every card and the Board inspector).
  import type { Shot } from '@storyboard-viewer/format';
  import { shotSummary } from '../lib/shot-summary';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';

  let {
    shot,
    label,
    controls,
    empty = '',
  }: { shot: Shot; label: string; controls: string; empty?: string } = $props();
  const text = $derived(shotSummary(shot) || empty);
</script>

<button
  type="button"
  class="summary"
  data-shot-summary={shot.id}
  aria-expanded={ui.shotMore}
  aria-controls={controls}
  aria-label="{ui.shotMore ? 'Hide' : 'Show'} details, tags and versions of {label}"
  title={ui.shotMore ? 'Hide' : 'Show'}
  onclick={() => ui.setShotMore(!ui.shotMore)}
>
  <span class="chev" class:open={ui.shotMore} aria-hidden="true"
    ><Icon name="next" size={10} /></span
  >
  <span class="text">{text}</span>
</button>

<style>
  .summary {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 24px;
    padding: 2px 4px;
    font: inherit;
    font-size: 12px;
    color: var(--fg-muted);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .summary:hover {
    color: var(--fg-2);
    background: var(--surface-2);
  }
  .summary:focus-visible {
    outline: 2px solid var(--focus, var(--accent));
    outline-offset: 1px;
  }
  .chev {
    display: grid;
    place-items: center;
    transition: rotate 120ms var(--ease);
  }
  .chev.open {
    rotate: 90deg;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
