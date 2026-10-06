<script lang="ts">
  import {
    ASSET_KINDS,
    PRESET_IDS,
    canvasForAspect,
    slugify,
    updateManifest,
    type AssetKind,
    type CategoryDef,
    type Manifest,
    type ShotFieldDef,
    type ShotFieldType,
  } from '@storyboard-viewer/format';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';
  import SuggestInput from './SuggestInput.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let dialog = $state<HTMLDialogElement>();
  let title = $state('');
  let description = $state('');
  let preset = $state('');
  let aspect = $state('16:9');
  let width = $state(1920);
  let height = $state(1080);
  let fps = $state(24);
  let defaultDuration = $state(3);
  let fields = $state<ShotFieldDef[]>([]);
  let categories = $state<CategoryDef[]>([]);
  let error = $state('');

  const ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '1.85:1', '2.39:1'];
  // "select" fields are free text whose options are offered as suggestions (no dropdowns).
  const FIELD_TYPES: ReadonlyArray<{ value: ShotFieldType; label: string }> = [
    { value: 'text', label: 'Text' },
    { value: 'longtext', label: 'Long text' },
    { value: 'number', label: 'Number' },
    { value: 'boolean', label: 'Yes/No' },
    { value: 'select', label: 'Suggestions' },
  ];

  $effect(() => {
    if (open && dialog && !dialog.open) {
      const m = app.project!.manifest;
      title = m.title;
      description = m.description ?? '';
      preset = m.preset ?? '';
      aspect = m.aspect_ratio ?? '16:9';
      width = m.canvas?.width ?? canvasForAspect(aspect).width;
      height = m.canvas?.height ?? canvasForAspect(aspect).height;
      fps = m.fps ?? 24;
      defaultDuration = m.default_shot_duration ?? 3;
      fields = structuredClone($state.snapshot(m.shot_fields ?? []) as ShotFieldDef[]);
      categories = structuredClone($state.snapshot(m.categories ?? []) as CategoryDef[]);
      error = '';
      dialog.showModal();
    } else if (!open && dialog?.open) dialog.close();
  });

  function uniqueId(label: string, taken: string[], fallback: string) {
    const base = slugify(label, fallback).replace(/-/g, '_');
    let id = base;
    for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
    return id;
  }

  function addField() {
    fields.push({
      id: uniqueId(
        'field',
        fields.map((f) => f.id),
        'field',
      ),
      label: 'New field',
      type: 'text',
    });
  }
  function addCategory() {
    categories.push({
      id: uniqueId(
        'category',
        categories.map((c) => c.id),
        'category',
      ),
      label: 'New category',
    });
  }
  function move<T>(list: T[], i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  function toggleKind(c: CategoryDef, k: AssetKind) {
    const kinds = new Set(c.kinds ?? []);
    if (kinds.has(k)) kinds.delete(k);
    else kinds.add(k);
    if (kinds.size) c.kinds = ASSET_KINDS.filter((x) => kinds.has(x));
    else delete c.kinds;
  }

  function apply(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim()) {
      error = 'Title is required';
      return;
    }
    if (!/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspect.trim())) {
      error = 'Aspect ratio looks like 16:9 or 2.39:1';
      return;
    }
    const clean = (s: string) => s.trim();
    const patch: Record<string, unknown> = {
      title: clean(title),
      description: clean(description) || null,
      preset: preset || null,
      aspect_ratio: aspect.trim(),
      canvas: { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) },
      fps: Math.max(1, Number(fps) || 24),
      default_shot_duration: Math.max(0.1, Number(defaultDuration) || 3),
      shot_fields: $state.snapshot(fields).map((f) => {
        const out: ShotFieldDef = { ...f, label: clean(f.label) || f.id };
        if (out.type !== 'select') delete out.options;
        else out.options = (out.options ?? []).map(clean).filter(Boolean);
        return out;
      }),
      categories: $state.snapshot(categories).map((c) => ({ ...c, label: clean(c.label) || c.id })),
    };
    if (app.edit('Project settings', (p) => updateManifest(p, patch as Partial<Manifest>)))
      open = false;
  }
</script>

<dialog
  bind:this={dialog}
  class="settings"
  aria-labelledby="settings-title"
  onclose={() => (open = false)}
>
  <form onsubmit={apply}>
    <header>
      <h2 id="settings-title">Project settings</h2>
      <button
        type="button"
        class="btn ghost icon"
        aria-label="Close settings"
        onclick={() => (open = false)}><Icon name="close" /></button
      >
    </header>
    <div class="body">
      <section class="grid">
        <label class="wide">
          <span>Title</span>
          <input id="settings-title-input" bind:value={title} required />
        </label>
        <label class="wide">
          <span>Description</span>
          <textarea rows="2" bind:value={description}></textarea>
        </label>
        <label>
          <span>Preset</span>
          <SuggestInput
            label="Preset"
            value={preset}
            suggestions={[...PRESET_IDS]}
            placeholder="none"
            oncommit={(v) => (preset = v)}
          />
        </label>
        <label>
          <span>Aspect ratio</span>
          <SuggestInput
            label="Aspect ratio"
            value={aspect}
            suggestions={ASPECTS}
            oncommit={(v) => {
              aspect = v;
              if (/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspect))
                ({ width, height } = canvasForAspect(aspect));
            }}
          />
        </label>
        <label>
          <span>Canvas width (px)</span>
          <input type="number" min="1" bind:value={width} />
        </label>
        <label>
          <span>Canvas height (px)</span>
          <input type="number" min="1" bind:value={height} />
        </label>
        <label>
          <span>Frames per second</span>
          <input type="number" min="1" step="any" bind:value={fps} />
        </label>
        <label>
          <span>Default shot length (s)</span>
          <input type="number" min="0.1" step="0.1" bind:value={defaultDuration} />
        </label>
      </section>

      <section>
        <h3>Shot fields <span class="muted">shown for every shot</span></h3>
        <ul class="rows">
          {#each fields as f, i (f.id)}
            <li class="row">
              <input aria-label="Field label" bind:value={f.label} />
              <Segmented
                label="Field type of {f.label}"
                bind:value={() => f.type ?? 'text', (v) => (f.type = v)}
                options={FIELD_TYPES}
              />
              {#if f.type === 'select'}
                <input
                  aria-label="Suggested values (comma separated)"
                  placeholder="Wide, Close-up"
                  value={(f.options ?? []).join(', ')}
                  onchange={(e) => (f.options = (e.target as HTMLInputElement).value.split(','))}
                />
              {:else}
                <span class="mono muted id" title="Field ID">{f.id}</span>
              {/if}
              <div class="row-actions">
                <button
                  type="button"
                  class="btn ghost icon"
                  aria-label="Move {f.label} up"
                  onclick={() => move(fields, i, -1)}><Icon name="up" size={14} /></button
                >
                <button
                  type="button"
                  class="btn ghost icon"
                  aria-label="Move {f.label} down"
                  onclick={() => move(fields, i, 1)}><Icon name="down" size={14} /></button
                >
                <button
                  type="button"
                  class="btn ghost icon"
                  aria-label="Remove {f.label}"
                  onclick={() => fields.splice(i, 1)}><Icon name="trash" size={14} /></button
                >
              </div>
            </li>
          {/each}
        </ul>
        <button type="button" class="btn small" onclick={addField}
          ><Icon name="plus" size={14} /> Add field</button
        >
      </section>

      <section>
        <h3>Asset categories</h3>
        <ul class="rows">
          {#each categories as c, i (c.id)}
            <li class="row">
              <input aria-label="Category label" bind:value={c.label} />
              <div class="kinds" role="group" aria-label="Kinds for {c.label}">
                {#each ASSET_KINDS as k (k)}
                  <label class="kind">
                    <input
                      type="checkbox"
                      checked={c.kinds?.includes(k) ?? false}
                      onchange={() => toggleKind(c, k)}
                    />{k}
                  </label>
                {/each}
              </div>
              <div class="row-actions">
                <button
                  type="button"
                  class="btn ghost icon"
                  aria-label="Move {c.label} up"
                  onclick={() => move(categories, i, -1)}><Icon name="up" size={14} /></button
                >
                <button
                  type="button"
                  class="btn ghost icon"
                  aria-label="Move {c.label} down"
                  onclick={() => move(categories, i, 1)}><Icon name="down" size={14} /></button
                >
                <button
                  type="button"
                  class="btn ghost icon"
                  aria-label="Remove {c.label}"
                  onclick={() => categories.splice(i, 1)}><Icon name="trash" size={14} /></button
                >
              </div>
            </li>
          {/each}
        </ul>
        <button type="button" class="btn small" onclick={addCategory}
          ><Icon name="plus" size={14} /> Add category</button
        >
      </section>
    </div>
    <footer>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
      <button type="submit" class="btn primary" id="settings-apply">Apply</button>
    </footer>
  </form>
</dialog>

<style>
  dialog {
    width: min(720px, calc(100vw - 32px));
    max-height: min(820px, calc(100vh - 48px));
    padding: 0;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 16px 48px var(--shadow-color);
  }
  dialog::backdrop {
    background: var(--backdrop);
  }
  form {
    display: flex;
    flex-direction: column;
    max-height: inherit;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }
  header {
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }
  h2 {
    font-size: 15px;
    margin: 0;
  }
  h3 {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
    margin: 0 0 var(--space-2);
  }
  h3 .muted {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  .body {
    overflow: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--space-3);
  }
  .grid .wide {
    grid-column: 1 / -1;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  label :global(.suggest) {
    display: flex;
  }
  label :global(.suggest input) {
    padding: 5px 8px;
  }
  input,
  textarea {
    font: inherit;
    font-size: 13px;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 5px 8px;
    min-width: 0;
  }
  .rows {
    list-style: none;
    margin: 0 0 var(--space-2);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(90px, 1fr) auto minmax(80px, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }
  .row:has(.kinds) {
    grid-template-columns: 1fr 2fr auto;
  }
  .id {
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-actions {
    display: flex;
  }
  .row-actions .btn {
    width: 26px;
    height: 26px;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .kind {
    flex-direction: row;
    align-items: center;
    gap: 4px;
    color: var(--fg-2);
  }
  .kind input {
    margin: 0;
  }
  .btn.small {
    padding: 3px 10px;
    font-size: 12px;
  }
  .error {
    color: var(--danger);
    margin: 0 auto 0 0;
    font-size: 13px;
  }
</style>
