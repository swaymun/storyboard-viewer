<script lang="ts">
  // Free text with suggestions (WAI-ARIA combobox with a list popup). Any text is allowed; the
  // popup offers preset and previously used values while focused, filtered by what is typed.
  // ↓/↑ move through suggestions, Enter picks (or commits the typed text), Esc closes the popup.
  // Used instead of native select menus (fixed choices) and datalists (suggestions people do not
  // notice).
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    value = '',
    suggestions = [],
    oncommit,
    onkeydown: onkeydownProp,
    clearOnCommit = false,
    commitOnBlur = true,
    label,
    max = 8,
    class: cls = '',
    inputEl = $bindable(),
    ...rest
  }: {
    value?: string;
    suggestions?: string[];
    /** Called with the final text (Enter, a picked suggestion, or blur when changed). */
    oncommit: (value: string) => void;
    /** Runs before the built-in keys; call preventDefault() to take over a key. */
    onkeydown?: (e: KeyboardEvent, text: string) => void;
    clearOnCommit?: boolean;
    commitOnBlur?: boolean;
    label: string;
    max?: number;
    class?: string;
    inputEl?: HTMLInputElement;
  } & Omit<HTMLInputAttributes, 'value' | 'onkeydown' | 'class'> = $props();

  const uid = `sg-${Math.random().toString(36).slice(2, 8)}`;
  let text = $state('');
  let focused = $state(false);
  let open = $state(false);
  let active = $state(-1);
  /** Typed since focus: filter by the text; before that, offer everything. */
  let typed = $state(false);
  /** Text at focus time: blur commits only when it changed. */
  let initial = '';

  $effect(() => {
    if (!focused) text = value ?? '';
  });

  const shown = $derived.by(() => {
    const q = typed ? text.trim().toLowerCase() : '';
    const uniq = [...new Set(suggestions.filter((s) => s && s.trim()))];
    const list = q
      ? uniq.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : uniq.filter((s) => s !== text);
    return list.slice(0, max);
  });
  const expanded = $derived(open && shown.length > 0);

  $effect(() => {
    void shown;
    if (active >= shown.length) active = -1;
  });

  function commit(v: string) {
    typed = false;
    open = false;
    active = -1;
    initial = v;
    oncommit(v);
    if (clearOnCommit) text = '';
    else text = v;
  }

  function onkeydown(e: KeyboardEvent) {
    onkeydownProp?.(e, text);
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open = true;
      active = shown.length ? (active + 1) % shown.length : -1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      open = true;
      active = shown.length ? (active <= 0 ? shown.length - 1 : active - 1) : -1;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (expanded && active >= 0) commit(shown[active]!);
      else if (text.trim() || !clearOnCommit) commit(text.trim());
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault();
        e.stopPropagation();
        open = false;
        active = -1;
      } else if (text !== initial) {
        e.preventDefault();
        e.stopPropagation();
        text = initial;
      }
    }
  }
</script>

<span class="suggest {cls}">
  <input
    bind:this={inputEl}
    {...rest}
    bind:value={text}
    role="combobox"
    aria-label={label}
    aria-autocomplete="list"
    aria-expanded={expanded}
    aria-controls="{uid}-list"
    aria-activedescendant={expanded && active >= 0 ? `${uid}-${active}` : undefined}
    autocomplete="off"
    onfocus={() => {
      focused = true;
      initial = text;
      typed = false;
      open = true;
    }}
    onblur={() => {
      focused = false;
      open = false;
      active = -1;
      if (commitOnBlur && text.trim() !== initial.trim()) commit(text.trim());
      else if (clearOnCommit) text = '';
    }}
    oninput={() => {
      typed = true;
      open = true;
      active = -1;
    }}
    {onkeydown}
  />
  <ul id="{uid}-list" role="listbox" aria-label="Suggestions for {label}" hidden={!expanded}>
    {#each shown as s, i (s)}
      <li
        id="{uid}-{i}"
        role="option"
        aria-selected={i === active}
        data-suggestion={s}
        onpointerdown={(e) => {
          e.preventDefault();
          commit(s);
        }}
      >
        {s}
      </li>
    {/each}
  </ul>
</span>

<style>
  .suggest {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }
  input {
    width: 100%;
  }
  ul {
    position: absolute;
    left: 0;
    top: calc(100% + 2px);
    z-index: 35;
    min-width: max(100%, 10em);
    max-width: 22em;
    max-height: 14em;
    overflow: auto;
    margin: 0;
    padding: 3px;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 6px 18px var(--shadow-color);
  }
  ul[hidden] {
    display: none;
  }
  li {
    padding: 3px 7px;
    font-size: 12.5px;
    color: var(--fg-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  li:hover,
  li[aria-selected='true'] {
    color: var(--fg);
    background: var(--surface-2);
  }
</style>
