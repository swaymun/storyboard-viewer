<script lang="ts">
  // The first-run offer ("New here? Take the tour"): a slim banner in the page flow between the
  // header and the content, so it pushes the views down instead of covering any toolbar, the
  // playback bar or the header. Shown once per browser (lib/tour.svelte.ts); Esc closes it.
  import { tour } from '../lib/tour.svelte';
  import { TOURS } from '../lib/tours';
  import Icon from './Icon.svelte';

  const gettingStarted = TOURS[0]!;
</script>

{#if tour.offer && !tour.tour}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    class="offer"
    id="tour-offer"
    aria-label="Guided tour"
    onkeydown={(e) => {
      if (e.key === 'Escape') tour.dismissOffer();
    }}
  >
    <Icon name="compass" size={16} />
    <p><b>New here?</b> {gettingStarted.summary}.</p>
    <div class="actions">
      <button
        type="button"
        class="btn small primary"
        id="tour-offer-start"
        onclick={() => void tour.start(gettingStarted.id)}>Take the tour</button
      >
      <button
        type="button"
        class="btn small ghost"
        id="tour-offer-dismiss"
        onclick={() => tour.dismissOffer()}>No thanks</button
      >
    </div>
  </section>
{/if}

<style>
  .offer {
    flex: none;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 6px var(--space-4);
    color: var(--fg);
    background: var(--accent-soft);
    border-bottom: 1px solid var(--border);
  }
  .offer :global(svg) {
    flex: none;
    color: var(--accent-text);
  }
  p {
    flex: 1 1 240px;
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--fg);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
</style>
