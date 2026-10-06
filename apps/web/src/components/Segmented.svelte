<script lang="ts" generics="T extends string | number">
  // A few fixed choices shown side by side (radio group), instead of a dropdown: every option is
  // visible at once. ←/→ move the choice; one tab stop.
  let {
    value = $bindable(),
    options,
    label,
    id,
    disabled = false,
  }: {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    label: string;
    id?: string;
    disabled?: boolean;
  } = $props();

  let el = $state<HTMLDivElement>();

  function onkeydown(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length]!;
    value = next.value;
    el?.querySelectorAll<HTMLElement>('[role="radio"]')[options.indexOf(next)]?.focus();
  }
</script>

<div class="seg" role="radiogroup" aria-label={label} {id} bind:this={el} data-value={value}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      data-value={o.value}
      {disabled}
      onclick={() => (value = o.value)}
      {onkeydown}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
    width: fit-content;
  }
  button {
    font: inherit;
    font-size: 12.5px;
    padding: 3px 10px;
    color: var(--fg-muted);
    background: var(--surface);
    border: 0;
    cursor: pointer;
  }
  button + button {
    border-left: 1px solid var(--border-strong);
  }
  button[aria-checked='true'] {
    color: var(--fg);
    background: var(--surface-3);
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
</style>
