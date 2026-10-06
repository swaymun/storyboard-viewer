<script lang="ts">
  // Modal asset chooser (filtered by kind) with an upload shortcut.
  import type { AssetKind } from '@storyboard-viewer/format';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(false),
    kinds,
    title = 'Choose an asset',
    onPick,
  }: {
    open: boolean;
    kinds: AssetKind[];
    title?: string;
    onPick: (assetId: string) => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  const uid = `picker-${Math.random().toString(36).slice(2, 8)}`;
  let fileInput = $state<HTMLInputElement>();
  let query = $state('');
  let busy = $state(false);

  const list = $derived(
    (app.project?.assets.assets ?? []).filter(
      (a) =>
        kinds.includes(a.kind) &&
        (!query.trim() ||
          `${a.name} ${a.id} ${(a.tags ?? []).join(' ')} ${a.category ?? ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())),
    ),
  );
  const accept = $derived(
    kinds.map((k) => (k === 'font' ? '.woff,.woff2,.ttf,.otf' : `${k}/*`)).join(','),
  );

  $effect(() => {
    if (open && dialog && !dialog.open) {
      query = '';
      dialog.showModal();
    } else if (!open && dialog?.open) dialog.close();
  });

  function pick(id: string) {
    open = false;
    onPick(id);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    busy = true;
    try {
      const ids = await app.importFiles([...files]);
      if (ids[0]) pick(ids[0]);
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="picker"
  aria-labelledby="{uid}-title"
  onclose={() => (open = false)}
>
  <header>
    <h2 id="{uid}-title">{title}</h2>
    <button type="button" class="btn ghost icon" aria-label="Close" onclick={() => (open = false)}
      ><Icon name="close" /></button
    >
  </header>
  <div class="bar">
    <input
      type="search"
      placeholder="Search assets"
      aria-label="Search assets"
      bind:value={query}
    />
    <button type="button" class="btn" disabled={busy} onclick={() => fileInput?.click()}>
      <Icon name="upload" size={14} />
      {busy ? 'Importing…' : 'Upload…'}
    </button>
    <input
      bind:this={fileInput}
      type="file"
      class="visually-hidden"
      multiple
      {accept}
      aria-label="Upload files"
      onchange={(e) => void upload((e.target as HTMLInputElement).files)}
    />
  </div>
  <ul class="grid">
    {#each list as a (a.id)}
      {@const thumb = a.kind === 'image' ? a.src : a.kind === 'video' ? a.poster : undefined}
      <li>
        <button type="button" data-asset-id={a.id} onclick={() => pick(a.id)}>
          <span class="thumb">
            {#if thumb && app.mediaUrl(thumb)}
              <img src={app.mediaUrl(thumb)} alt="" loading="lazy" />
            {:else}
              <Icon
                name={a.kind === 'audio' ? 'volume' : a.kind === 'video' ? 'film' : 'image'}
                size={20}
              />
            {/if}
          </span>
          <span class="name">{a.name}</span>
        </button>
      </li>
    {:else}
      <li class="muted none">No {kinds.join(' or ')} assets yet. Upload one.</li>
    {/each}
  </ul>
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 32px));
    max-height: min(640px, calc(100vh - 48px));
    padding: 0;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 16px 48px var(--shadow-color);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  h2 {
    font-size: 15px;
    margin: 0;
  }
  .bar {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }
  .bar input[type='search'] {
    flex: 1;
    font: inherit;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 5px 8px;
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-4) var(--space-4);
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-3);
  }
  .grid button {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 6px;
    font: inherit;
    font-size: 12px;
    color: inherit;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .grid button:hover,
  .grid button:focus-visible {
    border-color: var(--accent);
  }
  .thumb {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    background: repeating-conic-gradient(var(--surface-2) 0 25%, var(--surface) 0 50%) 0 0 / 12px
      12px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    color: var(--fg-muted);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    grid-column: 1 / -1;
    padding: var(--space-4) 0;
  }
</style>
