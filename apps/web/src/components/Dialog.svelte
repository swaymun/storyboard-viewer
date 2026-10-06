<script lang="ts">
  // Modal dialog shell (native <dialog>): header with title + close, scrolling body, footer.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(false),
    title,
    id,
    width = 640,
    onsubmit,
    onclose,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    id: string;
    width?: number;
    onsubmit?: () => void;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  {id}
  aria-labelledby="{id}-title"
  style:width="min({width}px, calc(100vw - 32px))"
  onclose={() => {
    open = false;
    onclose?.();
  }}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      onsubmit?.();
    }}
  >
    <header>
      <h2 id="{id}-title">{title}</h2>
      <button type="button" class="btn ghost icon" aria-label="Close" onclick={() => (open = false)}
        ><Icon name="close" /></button
      >
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </form>
</dialog>

<style>
  dialog {
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
  .body {
    overflow: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .body :global(label.field) {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .body :global(label.check) {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--fg-2);
  }
  .body :global(input:not([type='checkbox'], [type='radio'])),
  .body :global(select) {
    font: inherit;
    font-size: 13px;
    color: var(--fg);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 5px 8px;
    min-width: 0;
  }
  .body :global(fieldset) {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .body :global(legend) {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
    margin-bottom: var(--space-2);
    padding: 0;
  }
</style>
