<script lang="ts" module>
  /** "⌘⇧S" / "Ctrl+Shift+S" / "Alt+↑" → an aria-keyshortcuts value (best effort). */
  function keyshortcuts(s: string): string {
    return s
      .replace(/⌘/g, 'Meta+')
      .replace(/⇧/g, 'Shift+')
      .replace(/⌥/g, 'Alt+')
      .replace(/↑/g, 'ArrowUp')
      .replace(/↓/g, 'ArrowDown')
      .replace(/↵/g, 'Enter')
      .replace(/\+\+/g, '+');
  }
</script>

<script lang="ts">
  // The list part of every menu (button menus, the menu bar, context menus): role="menu" with
  // menuitem / menuitemcheckbox / menuitemradio children, roving focus with the arrow keys,
  // Home/End, type-ahead, submenus that open in place (→ / Enter, back with ← / Esc).
  import { tick } from 'svelte';
  import type { MenuItem } from '../lib/menu';
  import Icon from './Icon.svelte';

  let {
    items,
    label,
    id,
    onclose,
    onnavigate,
  }: {
    items: MenuItem[];
    label: string;
    id?: string;
    /** The menu wants to close; `returnFocus` = give focus back to whatever opened it. */
    onclose: (returnFocus: boolean) => void;
    /** ←/→ at the top level (menu bar: switch to the neighbouring menu). */
    onnavigate?: (dir: -1 | 1) => void;
  } = $props();

  /** Open submenus (labels into the item tree); empty = top level. */
  let path = $state<string[]>([]);
  const shown = $derived.by(() => {
    let list = items;
    for (const l of path) list = list.find((i) => i.label === l)?.submenu ?? list;
    return list;
  });
  let el = $state<HTMLDivElement>();
  let typed = '';
  let typedAt = 0;

  const enabled = () => [
    ...(el?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []),
  ];

  export async function focusItem(which: 'first' | 'last' = 'first') {
    await tick();
    const els = enabled();
    (which === 'first' ? els[0] : els.at(-1))?.focus();
  }

  function select(item: MenuItem) {
    if (item.disabled || item.heading) return;
    if (item.submenu) {
      path = [...path, item.label];
      void focusItem();
      return;
    }
    // Radio/checkbox items inside a submenu keep the menu open (try themes one after another).
    if (path.length && item.checked !== undefined) {
      item.onSelect?.();
      return;
    }
    onclose(true);
    item.onSelect?.();
  }

  function back() {
    path = path.slice(0, -1);
    void focusItem();
  }

  function onkeydown(e: KeyboardEvent) {
    const els = enabled();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const cur = document.activeElement as HTMLElement | null;
    if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus();
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === 'Home') els[0]?.focus();
    else if (e.key === 'End') els.at(-1)?.focus();
    else if (e.key === 'Escape' && path.length) back();
    else if (e.key === 'ArrowLeft' && path.length) back();
    else if (e.key === 'ArrowRight' && cur?.getAttribute('aria-haspopup') === 'menu') cur.click();
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onnavigate)
      onnavigate(e.key === 'ArrowLeft' ? -1 : 1);
    else if (e.key === 'Escape') onclose(true);
    else if (e.key === 'Tab') onclose(false);
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // type-ahead: focus the next item starting with the typed letters
      const now = Date.now();
      typed = now - typedAt < 700 ? typed + e.key.toLowerCase() : e.key.toLowerCase();
      typedAt = now;
      const n = els.length;
      const start = typed.length > 1 ? Math.max(0, i) : i + 1;
      for (let k = 0; k < n; k++) {
        const cand = els[(start + k) % n]!;
        if (cand.querySelector('.lbl')?.textContent?.trim().toLowerCase().startsWith(typed)) {
          cand.focus();
          break;
        }
      }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div bind:this={el} {id} class="menu-list" role="menu" aria-label={label} tabindex="-1" {onkeydown}>
  {#if path.length}
    <button type="button" role="menuitem" class="back" tabindex="-1" onclick={back}>
      <span class="ic"><Icon name="prev" size={14} /></span>
      <span class="lbl">{path.at(-1)}</span>
    </button>
    <div class="sep" role="separator"></div>
  {/if}
  {#each shown as item, i (i)}
    {#if item.separator}
      <div class="sep" role="separator"></div>
    {:else if item.heading}
      <div class="heading eyebrow" role="presentation">{item.label}</div>
    {:else}
      <button
        type="button"
        role={item.checked === undefined
          ? 'menuitem'
          : item.radio
            ? 'menuitemradio'
            : 'menuitemcheckbox'}
        aria-checked={item.checked === undefined ? undefined : item.checked}
        aria-disabled={item.disabled ? 'true' : undefined}
        aria-haspopup={item.submenu ? 'menu' : undefined}
        aria-keyshortcuts={item.shortcut ? keyshortcuts(item.shortcut) : undefined}
        data-theme-option={item.swatch}
        data-command={item.command}
        class:danger={item.danger}
        tabindex="-1"
        onclick={() => select(item)}
      >
        <span class="ic">
          {#if item.checked !== undefined}
            {#if item.checked}<Icon name="check" size={14} />{/if}
          {:else if item.icon}<Icon name={item.icon} size={14} />{/if}
        </span>
        {#if item.swatch}
          <span class="swatch" data-theme={item.swatch} aria-hidden="true">
            <span class="sw-text">Aa</span><span class="sw-accent"></span>
          </span>
        {/if}
        <span class="lbl">{item.label}</span>
        {#if item.detail}<span class="detail">{item.detail}</span>{/if}
        {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
        {#if item.submenu}<Icon name="next" size={14} />{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu-list {
    min-width: 220px;
    max-height: calc(100vh - 80px);
    overflow: auto;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 8px 24px var(--shadow-color);
    display: flex;
    flex-direction: column;
    outline: none;
  }
  [role^='menuitem'] {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 5px 8px;
    font: inherit;
    font-size: 13px;
    color: var(--fg);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  [role^='menuitem']:hover,
  [role^='menuitem']:focus {
    background: var(--surface-2);
    outline: none;
  }
  [role^='menuitem'][aria-disabled='true'] {
    color: var(--fg-faint);
    cursor: default;
  }
  [role^='menuitem'][aria-disabled='true']:hover {
    background: none;
  }
  [role^='menuitem'].danger {
    color: var(--danger);
  }
  .ic {
    width: 14px;
    display: inline-grid;
    place-items: center;
    color: var(--fg-muted);
  }
  .lbl {
    flex: 1;
  }
  kbd {
    margin-left: var(--space-4);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-muted);
  }
  .heading {
    padding: 6px 8px 2px;
  }
  .detail {
    color: var(--fg-muted);
    font-size: 12px;
  }
  .swatch {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 4px;
    background: var(--paper);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }
  .sw-text {
    font-family: var(--font-script);
    font-size: 11px;
    font-weight: 700;
    color: var(--sx-scene);
  }
  .sw-accent {
    width: 6px;
    height: 10px;
    border-radius: 1px;
    background: var(--accent);
  }
  .sep {
    height: 1px;
    margin: 4px 0;
    background: var(--border);
  }
</style>
