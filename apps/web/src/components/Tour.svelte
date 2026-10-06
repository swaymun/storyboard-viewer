<script lang="ts">
  // The guided tour overlay: a dimmed page with a cut-out around the step's target and a small
  // dialog next to it. Keyboard: → / Enter next, ← back, Esc ends; focus moves into the dialog
  // on every step and back to where it was when the tour ends. No animation when the user
  // prefers reduced motion. Also the first-run offer ("Take a 1-minute tour?"), a non-modal card
  // at the top right below the header (clear of the playback controls).
  import { tick } from 'svelte';
  import { tour } from '../lib/tour.svelte';
  import { TOURS } from '../lib/tours';
  import Icon from './Icon.svelte';

  let pop = $state<HTMLDivElement>();
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let found = $state(false);
  let pos = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  let ready = $state(false);

  const step = $derived(tour.tour?.steps[tour.step] ?? null);
  const total = $derived(tour.tour?.steps.length ?? 0);
  const last = $derived(tour.step === total - 1);

  /** First visible element with this data-tour value. */
  function findTarget(name: string): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }

  let target: HTMLElement | null = null;

  function measure() {
    if (!target?.isConnected) {
      rect = null;
    } else {
      const r = target.getBoundingClientRect();
      rect = { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 };
    }
    place();
  }

  function place() {
    if (!pop) return;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect) {
      pos = { left: (vw - pw) / 2, top: (vh - ph) / 2 };
      return;
    }
    const gap = 12;
    let left: number;
    let top: number;
    if (rect.y + rect.h + gap + ph < vh) {
      top = rect.y + rect.h + gap;
      left = rect.x + rect.w / 2 - pw / 2;
    } else if (rect.y - gap - ph > 0) {
      top = rect.y - gap - ph;
      left = rect.x + rect.w / 2 - pw / 2;
    } else if (rect.x + rect.w + gap + pw < vw) {
      left = rect.x + rect.w + gap;
      top = rect.y + rect.h / 2 - ph / 2;
    } else {
      left = rect.x - gap - pw;
      top = rect.y + rect.h / 2 - ph / 2;
    }
    pos = {
      left: Math.max(8, Math.min(left, vw - pw - 8)),
      top: Math.max(8, Math.min(top, vh - ph - 8)),
    };
  }

  // a new step: get the view ready, wait for the target, focus the dialog
  $effect(() => {
    const s = step;
    if (!s) return;
    let cancelled = false;
    ready = false;
    found = false;
    target = null;
    void (async () => {
      try {
        await s.prepare?.();
      } catch {
        /* the step still shows */
      }
      await tick();
      if (s.target) {
        for (let i = 0; i < 40 && !cancelled; i++) {
          target = findTarget(s.target);
          if (target) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      if (cancelled) return;
      found = !!target;
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      measure();
      ready = true;
      await tick();
      measure();
      pop?.focus();
    })();
    return () => {
      cancelled = true;
    };
  });

  // follow layout changes while a step shows
  $effect(() => {
    if (!tour.tour) return;
    const onChange = () => measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    const timer = setInterval(onChange, 400);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      clearInterval(timer);
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (!tour.tour) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      tour.stop();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      tour.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      tour.prev();
    }
  }

  const gettingStarted = TOURS[0]!;
</script>

{#if tour.tour && step}
  <div class="tour-layer" class:ready>
    {#if rect && found}
      <div
        class="spot"
        style:left="{rect.x}px"
        style:top="{rect.y}px"
        style:width="{rect.w}px"
        style:height="{rect.h}px"
      ></div>
    {:else}
      <div class="dim"></div>
    {/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="pop"
      bind:this={pop}
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      tabindex="-1"
      id="tour"
      data-tour-id={tour.tour.id}
      data-tour-step={tour.step}
      data-tour-target={step.target ?? ''}
      data-target-found={step.target ? String(found) : 'none'}
      data-ready={String(ready)}
      style:left="{pos.left}px"
      style:top="{pos.top}px"
      {onkeydown}
    >
      <header>
        <span class="count muted">{tour.tour.title} · {tour.step + 1} of {total}</span>
        <button type="button" class="close" aria-label="End the tour" onclick={() => tour.stop()}
          ><Icon name="close" size={14} /></button
        >
      </header>
      <h2 id="tour-title">{step.title}</h2>
      <p id="tour-body">{step.body}</p>
      <footer>
        <button
          type="button"
          class="btn small ghost"
          id="tour-back"
          disabled={tour.step === 0}
          onclick={() => tour.prev()}>Back</button
        >
        <button type="button" class="btn small primary" id="tour-next" onclick={() => tour.next()}
          >{last ? 'Done' : 'Next'}</button
        >
      </footer>
    </div>
  </div>
{/if}

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
    <Icon name="compass" size={18} />
    <div>
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
    </div>
  </section>
{/if}

<style>
  .tour-layer {
    position: fixed;
    inset: 0;
    z-index: 900;
    pointer-events: none;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: var(--backdrop);
  }
  .spot {
    position: absolute;
    border-radius: var(--radius-lg);
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 0 9999px var(--backdrop);
    transition:
      left 0.2s ease,
      top 0.2s ease,
      width 0.2s ease,
      height 0.2s ease;
  }
  .pop {
    position: fixed;
    width: min(340px, calc(100vw - 16px));
    padding: 12px 14px;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 10px 28px var(--shadow-color);
    pointer-events: auto;
    opacity: 0;
    transition: opacity 0.15s ease;
    outline: none;
  }
  .ready .pop {
    opacity: 1;
  }
  .pop:focus-visible {
    box-shadow: 0 0 0 2px var(--focus);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .count {
    font-size: 11px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--fg-muted);
    background: none;
    border: 0;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .close:hover {
    background: var(--surface-2);
  }
  h2 {
    margin: 4px 0 6px;
    font-size: 15px;
  }
  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 12px;
  }
  /* top right, just below the header: never over the playback bar (Play, the scrubber) at the
     bottom, nor over the menus and tabs in the header */
  .offer {
    position: fixed;
    right: 16px;
    top: 64px;
    z-index: 800;
    display: flex;
    gap: 10px;
    max-width: min(320px, calc(100vw - 32px));
    padding: 12px 14px;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 10px 28px var(--shadow-color);
  }
  .offer :global(svg) {
    flex: none;
    color: var(--accent-text);
    margin-top: 2px;
  }
  .offer p {
    margin: 0 0 8px;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  @media (prefers-reduced-motion: reduce) {
    .spot,
    .pop {
      transition: none;
    }
  }
</style>
