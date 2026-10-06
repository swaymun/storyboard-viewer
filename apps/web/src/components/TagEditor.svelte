<script lang="ts">
  // Shot tags: chips with a remove button, plus an input (type + Enter or comma; suggests tags
  // used on other shots; Backspace on an empty input removes the last tag).
  import { tooltip } from '../lib/tooltip';
  import { updateShot, type Shot } from '@storyboard-viewer/format';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import SuggestInput from './SuggestInput.svelte';

  let { shot, label, compact = false }: { shot: Shot; label: string; compact?: boolean } = $props();

  const tags = $derived(shot.tags ?? []);
  let input = $state<HTMLInputElement>();
  const suggestions = $derived(app.allTags.filter((t) => !tags.includes(t)));

  function save(next: string[]) {
    app.edit('Edit tags', (p) => updateShot(p, shot.id, { tags: next.length ? next : null }));
  }

  function add(raw: string) {
    const parts = raw
      .split(',')
      .map((t) => t.trim().replace(/\s+/g, '-'))
      .filter(Boolean);
    const next = [...tags];
    for (const t of parts) if (!next.includes(t)) next.push(t);
    if (next.length !== tags.length) save(next);
  }

  function remove(tag: string) {
    save(tags.filter((t) => t !== tag));
    input?.focus();
  }

  /** Comma adds the typed tag; Backspace in an empty input removes the last tag. */
  function onkeydown(e: KeyboardEvent, text: string) {
    if (e.key === ',' && text.trim()) {
      e.preventDefault();
      add(text);
      if (input) input.value = '';
      input?.dispatchEvent(new Event('input'));
    } else if (e.key === 'Backspace' && !text && tags.length) {
      e.preventDefault();
      save(tags.slice(0, -1));
    }
  }
</script>

<div class="tags" class:compact role="group" aria-label="Tags of {label}" data-tags={shot.id}>
  {#each tags as t (t)}
    <span class="tag" data-tag={t}>
      <span class="t">{t}</span>
      {#if app.canEdit}
        <button
          type="button"
          class="x"
          aria-label="Remove tag {t} from {label}"
          {@attach tooltip('Remove tag')}
          onclick={() => remove(t)}><Icon name="close" size={10} /></button
        >
      {/if}
    </span>
  {/each}
  {#if app.canEdit}
    <SuggestInput
      bind:inputEl={input}
      class="add"
      label="Add a tag to {label}"
      placeholder={tags.length ? '+ tag' : '+ Add tag'}
      {suggestions}
      clearOnCommit
      oncommit={(v) => v && add(v)}
      {onkeydown}
    />
  {/if}
</div>

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    font-size: 11.5px;
    line-height: 18px;
    color: var(--fg-2);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0 2px 0 6px;
  }
  .tag .t::before {
    content: '#';
    color: var(--fg-muted);
  }
  .tag .t {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 4px;
  }
  .x {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    padding: 0;
    color: var(--fg-muted);
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .x:hover {
    color: var(--fg);
    background: var(--surface-3);
  }
  .tags :global(.add input) {
    width: 7.5em;
    font-size: 11.5px;
    padding: 0 6px;
    height: 20px;
    background: transparent;
    border: 1px dashed var(--border-strong);
  }
  .tags :global(.add input:focus) {
    width: 10em;
    border-style: solid;
  }
  .compact :global(.add input) {
    opacity: 0;
    transition: opacity 120ms var(--ease);
  }
  .compact :global(.add input:focus),
  .compact:hover :global(.add input),
  :global(.shot:hover) .compact :global(.add input),
  :global(.shot.selected) .compact :global(.add input) {
    opacity: 1;
  }
</style>
