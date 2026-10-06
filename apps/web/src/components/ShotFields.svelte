<script lang="ts">
  // Shot details (fields). Only fields with a value are shown. "Add detail" suggests the
  // project's preset fields and accepts a new name: a new name becomes a field definition in the
  // manifest (one undo step with the value). Emptying a field removes it from the shot.
  import {
    slugify,
    updateManifest,
    updateShot,
    type FieldValue,
    type Shot,
    type ShotFieldDef,
  } from '@storyboard-viewer/format';
  import { tick } from 'svelte';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import SuggestInput from './SuggestInput.svelte';

  let { shot, label }: { shot: Shot; label: string } = $props();

  const id = $derived(shot.id);
  const defs = $derived(app.project?.manifest.shot_fields ?? []);
  const uid = `fields-${Math.random().toString(36).slice(2, 8)}`;
  /** Fields just added from "Add detail" (shown while still empty). */
  let pending = $state<string[]>([]);
  let root = $state<HTMLElement>();

  const has = (v: FieldValue | undefined) => v !== undefined && v !== null && v !== '';
  const rows = $derived.by(() => {
    const values = shot.fields ?? {};
    const out: Array<{
      key: string;
      def: ShotFieldDef | undefined;
      value: FieldValue | undefined;
    }> = [];
    for (const d of defs)
      if (has(values[d.id]) || pending.includes(d.id))
        out.push({ key: d.id, def: d, value: values[d.id] });
    for (const [k, v] of Object.entries(values))
      if (!defs.some((d) => d.id === k) && (has(v) || pending.includes(k)))
        out.push({ key: k, def: undefined, value: v });
    for (const k of pending)
      if (!out.some((r) => r.key === k)) out.push({ key: k, def: undefined, value: undefined });
    return out;
  });
  const unused = $derived(defs.filter((d) => !rows.some((r) => r.key === d.id)));
  /** Preset choices first, then values other shots use for this field. */
  function suggestionsFor(key: string, d: ShotFieldDef | undefined): string[] {
    const used = Object.values(app.project?.shots ?? {})
      .map((s) => s.fields?.[key])
      .filter(
        (v): v is string | number => (typeof v === 'string' && v !== '') || typeof v === 'number',
      )
      .map(String);
    return [...(d?.options ?? []), ...used.toSorted((a, b) => a.localeCompare(b))];
  }
  const labelOf = (key: string, def?: ShotFieldDef) => def?.label ?? key.replace(/_/g, ' ');

  function setField(key: string, value: FieldValue) {
    app.edit(
      `Edit ${key.replace(/_/g, ' ')}`,
      (p) => updateShot(p, id, { fields: { [key]: value } }),
      { coalesce: `${id}:field:${key}` },
    );
    if (has(value)) pending = pending.filter((k) => k !== key);
  }

  function valueOf(d: ShotFieldDef | undefined, raw: string | boolean): FieldValue {
    if (typeof raw === 'boolean') return raw;
    if (raw.trim() === '') return null;
    if (d?.type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return raw;
  }

  async function focusField(key: string) {
    await tick();
    root
      ?.querySelector<HTMLElement>(`[data-field-input="${CSS.escape(key)}"] :is(input, textarea)`)
      ?.focus();
  }

  /** Adds a preset field, or creates a new field definition named `name`. */
  function addDetail(name: string) {
    const text = name.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    const def = defs.find((d) => d.label.toLowerCase() === lower || d.id === lower);
    if (def) {
      if (!pending.includes(def.id)) pending = [...pending, def.id];
      void focusField(def.id);
      return;
    }
    const base = slugify(text, 'field').replace(/-/g, '_');
    let key = base;
    for (let n = 2; defs.some((d) => d.id === key); n++) key = `${base}_${n}`;
    const field: ShotFieldDef = { id: key, label: text, type: 'text' };
    if (
      app.edit('Add detail', (p) =>
        updateManifest(p, { shot_fields: [...(p.manifest.shot_fields ?? []), field] }),
      )
    ) {
      pending = [...pending, key];
      void focusField(key);
    }
  }

  function onBlurField(key: string, value: FieldValue | undefined) {
    // An added field left empty disappears again.
    if (!has(value)) setTimeout(() => (pending = pending.filter((k) => k !== key)), 150);
  }
</script>

<div class="fields" bind:this={root} data-fields={id}>
  {#if rows.length}
    <dl>
      {#each rows as r (r.key)}
        {@const d = r.def}
        <div class="row" data-field={r.key} data-field-input={r.key}>
          <dt>
            <label for="{uid}-{r.key}" title={d?.description}>{labelOf(r.key, d)}</label>
          </dt>
          <dd>
            {#if !app.canEdit}
              <span class="ro"
                >{typeof r.value === 'boolean'
                  ? r.value
                    ? 'Yes'
                    : 'No'
                  : String(r.value ?? '')}</span
              >
            {:else if d?.type === 'longtext'}
              <textarea
                id="{uid}-{r.key}"
                rows="2"
                value={r.value == null ? '' : String(r.value)}
                placeholder={d.placeholder}
                onchange={(e) =>
                  setField(r.key, valueOf(d, (e.target as HTMLTextAreaElement).value))}
                onblur={() => onBlurField(r.key, shot.fields?.[r.key])}></textarea>
            {:else if d?.type === 'boolean'}
              <input
                id="{uid}-{r.key}"
                type="checkbox"
                checked={r.value === true}
                onchange={(e) => setField(r.key, (e.target as HTMLInputElement).checked)}
              />
            {:else if d?.type === 'number'}
              <input
                id="{uid}-{r.key}"
                type="number"
                step="any"
                value={r.value == null ? '' : String(r.value)}
                placeholder={d?.placeholder}
                onchange={(e) => setField(r.key, valueOf(d, (e.target as HTMLInputElement).value))}
                onblur={() => onBlurField(r.key, shot.fields?.[r.key])}
              />
            {:else}
              <!-- Free text; presets (select options) and values used on other shots are suggestions. -->
              <SuggestInput
                id="{uid}-{r.key}"
                class="value"
                label="{labelOf(r.key, d)} of {label}"
                value={r.value == null ? '' : String(r.value)}
                suggestions={suggestionsFor(r.key, d)}
                placeholder={d?.placeholder ??
                  (d?.options?.length ? d.options.slice(0, 2).join(', ') + '…' : '')}
                oncommit={(v) => {
                  if (v !== (r.value == null ? '' : String(r.value)))
                    setField(r.key, valueOf(d, v));
                  else onBlurField(r.key, shot.fields?.[r.key]);
                }}
              />
            {/if}
          </dd>
          {#if app.canEdit}
            <button
              type="button"
              class="rm"
              aria-label="Remove {labelOf(r.key, d)} from {label}"
              title="Remove"
              onclick={() => {
                pending = pending.filter((k) => k !== r.key);
                setField(r.key, null);
              }}><Icon name="close" size={12} /></button
            >
          {/if}
        </div>
      {/each}
    </dl>
  {/if}
  {#if app.canEdit}
    <div class="add">
      <Icon name="plus" size={12} />
      <SuggestInput
        class="add-detail"
        label="Add detail to {label} (pick a field or type a new name)"
        placeholder="Add detail"
        suggestions={unused.map((d) => d.label)}
        clearOnCommit
        commitOnBlur={false}
        oncommit={addDetail}
      />
    </div>
  {/if}
</div>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  dl {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(64px, 32%) 1fr auto;
    align-items: start;
    gap: 4px;
  }
  dt {
    min-width: 0;
    padding-top: 5px;
    line-height: 1.2;
  }
  dt label {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  dd :is(input:not([type='checkbox']), textarea),
  dd :global(.value input) {
    width: 100%;
    font-size: 13px;
    padding: 2px 6px;
    background: transparent;
    border-color: transparent;
  }
  dd :global(.value) {
    display: flex;
    width: 100%;
  }
  dd :is(input, textarea):hover,
  dd :global(.value input:hover) {
    border-color: var(--border);
  }
  dd :is(input, textarea):focus,
  dd :global(.value input:focus) {
    background: var(--surface);
  }
  textarea {
    resize: vertical;
  }
  .ro {
    font-size: 13px;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }
  .rm {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    color: var(--fg-muted);
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
  }
  .row:hover .rm,
  .rm:focus-visible {
    opacity: 1;
  }
  .rm:hover {
    color: var(--danger);
  }
  .add {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--fg-muted);
  }
  .add :global(.add-detail) {
    flex: 1;
    max-width: 16em;
  }
  .add :global(.add-detail input) {
    font-size: 12px;
    padding: 1px 4px;
    background: transparent;
    border-color: transparent;
  }
  .add :global(.add-detail input:hover) {
    border-color: var(--border);
  }
</style>
