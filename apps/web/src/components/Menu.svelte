<script lang="ts" module>
  export type { MenuItem } from '../lib/menu';
</script>

<script lang="ts">
  // A button that opens a menu (menu button pattern): ↓/Enter/Space opens on the first item,
  // ↑ on the last; Esc closes and returns focus to the button.
  import { tick } from 'svelte';
  import type { MenuItem } from '../lib/menu';
  import type { IconName } from './Icon.svelte';
  import Icon from './Icon.svelte';
  import MenuList from './MenuList.svelte';

  let {
    label,
    icon = 'more',
    text = '',
    items,
    align = 'right',
    id,
    small = false,
  }: {
    label: string;
    icon?: IconName;
    text?: string;
    items: MenuItem[];
    align?: 'left' | 'right';
    id?: string;
    small?: boolean;
  } = $props();

  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let wrap = $state<HTMLDivElement>();
  let list = $state<MenuList>();
  const uid = `menu-${Math.random().toString(36).slice(2, 8)}`;

  async function show(focus: 'first' | 'last' = 'first') {
    open = true;
    await tick();
    await list?.focusItem(focus);
  }

  function hide(returnFocus = true) {
    open = false;
    if (returnFocus) button?.focus();
  }

  function onWindowPointer(e: PointerEvent) {
    if (open && !wrap?.contains(e.target as Node)) hide(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="menu-wrap" bind:this={wrap}>
  <button
    bind:this={button}
    {id}
    type="button"
    class="btn ghost"
    class:icon={!text}
    class:small
    aria-label={text ? undefined : label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? uid : undefined}
    onclick={() => (open ? hide() : void show())}
    onkeydown={(e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        void show('first');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        void show('last');
      }
    }}
  >
    <Icon name={icon} size={small ? 14 : 16} />{text}
  </button>
  {#if open}
    <div class="pop" class:left={align === 'left'}>
      <MenuList bind:this={list} id={uid} {label} {items} onclose={hide} />
    </div>
  {/if}
</div>

<style>
  .menu-wrap {
    position: relative;
    display: inline-flex;
  }
  .btn.small {
    width: 26px;
    height: 26px;
    padding: 4px;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 30;
  }
  .pop.left {
    right: auto;
    left: 0;
  }
</style>
