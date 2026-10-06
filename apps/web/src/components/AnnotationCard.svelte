<script lang="ts">
  // One shot beside the script (Script view). A shot can be just a picture, just a sound, or
  // both, so the card shows only what the shot has: the picture (or a drop target to add one),
  // its sound (when it has any) and the title (when it has one). Details, tags and more pictures
  // appear when they have a value, or from the "+" menu. Collapsed (not the open shot): a small
  // thumbnail and the number. Right-click (or Shift+F10) for the shot's commands.
  import { tooltip } from '../lib/tooltip';
  import {
    addVariant,
    aspectValue,
    isLineTarget,
    isRangeTarget,
    isShotTarget,
    updateShot,
    type Shot,
    type ShotRef,
  } from '@storyboard-viewer/format';
  import { tick } from 'svelte';
  import { audio } from '../lib/audio-editor.svelte';
  import { isContextMenuKey, sep, type MenuItem } from '../lib/menu';
  import { adjustBoundary } from '../lib/script-editor/actions';
  import { addImageToShot, moveShotBy, shotMenuItems } from '../lib/shot-actions';
  import { player } from '../lib/player.svelte';
  import { app } from '../lib/state.svelte';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import ShotAudio from './ShotAudio.svelte';
  import ShotFields from './ShotFields.svelte';
  import ShotSummary from './ShotSummary.svelte';
  import { shotSummary } from '../lib/shot-summary';
  import TagEditor from './TagEditor.svelte';
  import VariantCarousel from './VariantCarousel.svelte';
  import VariantView from './VariantView.svelte';

  let {
    entry,
    active,
    hover,
    top,
    dragging = false,
    onselect,
    ongrip,
    onmoved,
    onheight,
  }: {
    entry: { ref: ShotRef; shot: Shot; index: number };
    active: boolean;
    hover: boolean;
    top: number;
    dragging?: boolean;
    onselect: () => void;
    ongrip: (e: PointerEvent) => void;
    onmoved: (message: string) => void;
    onheight: (h: number) => void;
  } = $props();

  const shot = $derived(entry.shot);
  const ref = $derived(entry.ref);
  const label = $derived(`Shot ${entry.index + 1}${shot.title ? `: ${shot.title}` : ''}`);
  const color = $derived((entry.index % 6) + 1);
  const ratio = $derived(aspectValue(app.project?.manifest.aspect_ratio));
  const hasPicture = $derived(!!shot.variants?.length);
  const hasDetails = $derived(
    Object.values(shot.fields ?? {}).some((v) => v !== null && v !== '') || !!shot.tags?.length,
  );
  const hasSound = $derived.by(() => {
    const lines = new Set(ref.lines);
    return (app.project?.timeline.cues ?? []).some(
      (c) =>
        (isShotTarget(c.target) && c.target.shot === shot.id) ||
        (isLineTarget(c.target) && lines.has(c.target.line)) ||
        (isRangeTarget(c.target) && c.target.range.some((l) => lines.has(l))),
    );
  });
  /** Sections asked for with "+" (shown even while still empty). */
  let wantTitle = $state(false);
  let wantDetails = $state(false);
  let wantSound = $state(false);
  let dropping = $state(false);
  let height = $state(0);
  let card = $state<HTMLElement>();
  $effect(() => onheight(height));
  $effect(() => {
    if (!active) wantTitle = wantDetails = wantSound = false;
  });

  const showTitleInput = $derived(active && app.canEdit && (!!shot.title || wantTitle));
  /** Existing details, tags and versions fold into one summary row until expanded. */
  const hasMore = $derived(shotSummary(shot) !== '');
  const showDetails = $derived(active && (wantDetails || (hasDetails && ui.shotMore)));
  const showSound = $derived(active && (hasSound || wantSound));
  /**
   * A shot that already has a sound (or details) gets a small "Add image" row under it; only a
   * completely empty shot gets the large picture-shaped drop target.
   */
  const slimDrop = $derived(hasSound || wantSound || hasDetails);

  const boundary = (edge: 'start' | 'end', delta: number, what: string) =>
    app.edit(what, (p) => adjustBoundary(p, shot.id, edge, delta));

  const items = $derived<MenuItem[]>([
    ...shotMenuItems(shot.id, { onMoved: onmoved }),
    ...(app.canEdit && ref.lines.length
      ? [
          sep(),
          { label: 'Script range', heading: true },
          {
            label: 'Start one line earlier',
            icon: 'up' as const,
            command: 'start-earlier',
            onSelect: () => boundary('start', -1, 'Grow shot'),
          },
          {
            label: 'Start one line later',
            icon: 'down' as const,
            command: 'start-later',
            onSelect: () => boundary('start', 1, 'Shrink shot'),
          },
          {
            label: 'End one line earlier',
            icon: 'up' as const,
            command: 'end-earlier',
            onSelect: () => boundary('end', -1, 'Shrink shot'),
          },
          {
            label: 'End one line later',
            icon: 'down' as const,
            command: 'end-later',
            onSelect: () => boundary('end', 1, 'Grow shot'),
          },
        ]
      : []),
  ]);

  async function focusIn(sel: string) {
    await tick();
    card?.querySelector<HTMLElement>(sel)?.focus();
  }

  /** Shows the Audio section (open): sounds on the shot, or a recording split over its lines. */
  function showAudio() {
    wantSound = true;
    audio.sectionOpen = true;
    void focusIn('[data-audio-section] .sec-head');
  }

  const addItems = $derived<MenuItem[]>([
    {
      label: 'Title',
      icon: 'edit',
      command: 'add-title',
      disabled: !!shot.title,
      onSelect: () => {
        wantTitle = true;
        void focusIn('[data-annotation-title]');
      },
    },
    {
      label: hasPicture ? 'Another picture…' : 'Picture…',
      icon: 'image',
      command: 'add-picture',
      onSelect: () => void addImageToShot(shot.id),
    },
    { label: 'Sound', icon: 'volume', command: 'add-sound', onSelect: () => showAudio() },
    {
      label: 'Details and tags',
      icon: 'tag',
      command: 'add-details',
      onSelect: () => {
        wantDetails = true;
        ui.setShotMore(true);
        void focusIn('[data-add-detail] input, [role="combobox"]');
      },
    },
  ]);

  function move(delta: number) {
    const msg = moveShotBy(shot.id, delta);
    if (msg) onmoved(msg);
  }

  function onkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (isContextMenuKey(e) && !t.closest('input, textarea')) {
      ui.openContextMenu(e, items, `Actions for ${label}`);
      return;
    }
    if (!app.canEdit || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (t.closest('input, textarea')) return;
    e.preventDefault();
    move(e.key === 'ArrowUp' ? -1 : 1);
  }

  function oncontextmenu(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea')) return; // keep the browser's text menu in fields
    ui.openContextMenu(e, items, `Actions for ${label}`);
  }

  /** A picture dropped on the empty picture area: import it and show it in this shot. */
  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /^(image|video)\//.test(f.type));
    if (!files.length || !app.canEdit) return;
    const [assetId] = await app.importFiles(files.slice(0, 1));
    if (!assetId) return;
    const asset = app.assets.get(assetId);
    app.edit('Add picture', (p) =>
      addVariant(
        p,
        shot.id,
        { type: 'image', asset: assetId, name: asset?.name ?? 'Image' },
        { activate: true },
      ),
    );
  }
</script>

{#snippet dropTarget()}
  <button
    type="button"
    class="drop"
    class:slim={slimDrop}
    class:dropping
    data-add-picture={shot.id}
    style:aspect-ratio={slimDrop ? undefined : String(ratio)}
    aria-label="Add a picture to {label} (or drop an image here)"
    onclick={() => void addImageToShot(shot.id)}
    ondragover={(e) => {
      e.preventDefault();
      dropping = true;
    }}
    ondragleave={() => (dropping = false)}
    ondrop={onDrop}><Icon name="image" size={slimDrop ? 13 : 16} /><span>Add image</span></button
  >
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class="card shot"
  class:active
  class:hover
  class:dragging
  data-shot-id={shot.id}
  data-annotation={shot.id}
  aria-labelledby="ann-title-{shot.id}"
  aria-current={active ? 'true' : undefined}
  data-tour={active ? 'shot-card' : undefined}
  style:top="{top}px"
  style:--shot-c="var(--shot-{color})"
  bind:clientHeight={height}
  bind:this={card}
  {onkeydown}
  {oncontextmenu}
>
  <header>
    {#if app.canEdit}
      <span
        role="button"
        tabindex="0"
        class="grip"
        aria-label="Reorder {label} (moves its script text too)"
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        {@attach tooltip('Drag to reorder', 'or Alt+↑/↓')}
        onpointerdown={ongrip}
        onkeydown={(e) => {
          if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            e.stopPropagation();
            move(e.key === 'ArrowUp' ? -1 : 1);
          }
        }}><Icon name="grip" size={12} /></span
      >
    {/if}
    <button
      type="button"
      class="select"
      class:narrow={showTitleInput}
      aria-expanded={active}
      aria-label={active ? `Close ${label}` : undefined}
      onclick={onselect}
    >
      <span class="num mono" aria-hidden="true">{entry.index + 1}</span>
      <h3 id="ann-title-{shot.id}" class:visually-hidden={showTitleInput || !shot.title}>
        <span class="visually-hidden">Shot {entry.index + 1}{shot.title ? ':' : ''}</span>
        {shot.title ?? ''}
      </h3>
    </button>
    {#if showTitleInput}
      <input
        class="title-input"
        value={shot.title ?? ''}
        placeholder="Title"
        aria-label="Title of shot {entry.index + 1}"
        data-annotation-title={shot.id}
        onkeydown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        onchange={(e) =>
          app.edit('Rename shot', (p) =>
            updateShot(p, shot.id, {
              title: (e.target as HTMLInputElement).value.trim() || null,
            }),
          )}
      />
    {/if}
    <span class="tools">
      {#if active && app.canEdit}
        <span data-tour="card-add"
          ><Menu
            label="Add to {label}"
            icon="plus"
            items={addItems}
            small
            id="add-to-{shot.id}"
          /></span
        >
      {/if}
      <button
        type="button"
        class="btn ghost icon"
        aria-label="Play from {label}"
        onclick={() => player.playShot(shot.id)}><Icon name="play" size={11} /></button
      >
      {#if active}
        <Menu label="Actions for {label}" {items} small />
      {/if}
    </span>
  </header>

  {#if active}
    {#if hasPicture}
      <div class="picture" style:width="min(100%, {Math.round(180 * ratio)}px)">
        <VariantCarousel {shot} {label} strip={ui.shotMore} />
      </div>
    {:else if app.canEdit && !slimDrop}
      {@render dropTarget()}
    {/if}
    {#if showSound}
      <ShotAudio {entry} {label} />
    {/if}
    {#if !hasPicture && app.canEdit && slimDrop}
      {@render dropTarget()}
    {/if}
    {#if hasMore}
      <ShotSummary {shot} {label} controls="more-{shot.id}" />
    {/if}
    {#if showDetails}
      <section class="details" id="more-{shot.id}" aria-label="Details of {label}">
        <ShotFields {shot} {label} />
        <TagEditor {shot} {label} />
      </section>
    {/if}
  {:else}
    <button
      type="button"
      class="thumb"
      tabindex="-1"
      aria-hidden="true"
      style:width="{Math.max(24, Math.round(40 * ratio))}px"
      onclick={onselect}
    >
      {#if hasPicture}
        <VariantView variant={app.shownVariant(shot)} {label} />
      {:else}
        <span class="no-pic"
          >{#if hasSound}<Icon name="volume" size={12} />{/if}</span
        >
      {/if}
    </button>
  {/if}
</article>

<style>
  .card {
    position: absolute;
    left: 0;
    right: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 6px 6px;
    transition:
      top 160ms var(--ease),
      border-color 120ms var(--ease),
      box-shadow 120ms var(--ease);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card::before {
    /* the shot's colour, as a small mark that matches its text in the script */
    content: '';
    position: absolute;
    left: -1px;
    top: 8px;
    width: 2px;
    height: 14px;
    border-radius: 0 2px 2px 0;
    background: var(--shot-c);
    opacity: 0.8;
  }
  .card:not(.active) {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    align-items: start;
    border-color: transparent;
    background: transparent;
  }
  .card:not(.active):hover,
  .card.hover:not(.active) {
    border-color: var(--border);
    background: var(--surface);
  }
  .card:not(.active) header {
    grid-column: 2;
    grid-row: 1;
  }
  .card:not(.active) .thumb {
    grid-column: 1;
    grid-row: 1;
  }
  .card.active {
    z-index: 2;
    border-color: var(--border-strong);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 8px 24px var(--shadow-color);
  }
  .card.dragging {
    opacity: 0.5;
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 22px;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 14px;
    height: 20px;
    margin-left: -3px;
    color: var(--fg-muted);
    cursor: grab;
    border-radius: var(--radius-sm);
    touch-action: none;
    opacity: 0;
    transition: opacity 120ms var(--ease);
  }
  .card:hover .grip,
  .card.active .grip,
  .grip:focus-visible {
    opacity: 1;
  }
  .select {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .select.narrow {
    flex: none;
  }
  .num {
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-muted);
    min-width: 1.2em;
  }
  .card.active .num {
    color: var(--fg-2);
  }
  h3 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title-input {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 600;
    padding: 1px 4px;
    background: transparent;
    border-color: transparent;
  }
  .title-input:hover {
    border-color: var(--border);
  }
  .title-input:focus {
    background: var(--surface);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex: none;
  }
  .card:not(.active):not(:hover):not(.hover) .tools {
    opacity: 0;
  }
  .card:not(.active) .tools:focus-within {
    opacity: 1;
  }
  .btn.icon {
    width: 22px;
    height: 22px;
    padding: 4px;
    flex: none;
  }
  .thumb {
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    align-self: start;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .no-pic {
    display: grid;
    place-items: center;
    width: 100%;
    height: 40px;
    color: var(--fg-muted);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
  }
  .picture {
    align-self: center;
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: min(100%, 220px);
    align-self: center;
    font: inherit;
    font-size: 12px;
    color: var(--fg-muted);
    background: transparent;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    cursor: pointer;
    transition:
      border-color 120ms var(--ease),
      color 120ms var(--ease);
  }
  .drop.slim {
    flex-direction: row;
    justify-content: flex-start;
    gap: 6px;
    width: 100%;
    min-height: 26px;
    padding: 3px 6px;
    border-color: transparent;
    border-radius: var(--radius-sm);
  }
  .drop.slim.dropping {
    border-color: var(--accent);
  }
  .drop.slim:hover:not(.dropping) {
    border-color: transparent;
    background: var(--surface-2);
  }
  .drop:hover,
  .drop.dropping {
    color: var(--fg);
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
</style>
