<script lang="ts">
  // The one open context menu (right click, Shift+F10 or the Menu key), positioned at the pointer
  // and kept inside the window. Esc closes it and gives focus back to where it was opened.
  import { tick } from 'svelte';
  import { ui } from '../lib/ui.svelte';
  import MenuList from './MenuList.svelte';

  let box = $state<HTMLDivElement>();
  let list = $state<MenuList>();
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    const m = ui.contextMenu;
    if (!m) return;
    pos = { x: m.x, y: m.y };
    void tick().then(() => {
      if (!box) return;
      const r = box.getBoundingClientRect();
      pos = {
        x: Math.max(4, Math.min(m.x, window.innerWidth - r.width - 4)),
        y: Math.max(4, m.y + r.height > window.innerHeight - 4 ? m.y - r.height : m.y),
      };
      void list?.focusItem('first');
    });
  });

  function onPointer(e: PointerEvent) {
    if (ui.contextMenu && !box?.contains(e.target as Node)) ui.closeContextMenu(false);
  }
</script>

<svelte:window
  onpointerdown={onPointer}
  onresize={() => ui.contextMenu && ui.closeContextMenu(false)}
  onblur={() => ui.contextMenu && ui.closeContextMenu(false)}
/>

{#if ui.contextMenu}
  <div
    class="context-menu"
    bind:this={box}
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    data-context-menu
  >
    <MenuList
      bind:this={list}
      items={ui.contextMenu.items}
      label={ui.contextMenu.label}
      onclose={(back) => ui.closeContextMenu(back)}
    />
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 60;
  }
</style>
