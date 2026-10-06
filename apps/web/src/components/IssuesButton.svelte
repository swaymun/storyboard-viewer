<script lang="ts">
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let open = $state(false);
  const shown = $derived(app.issues.filter((i) => i.severity !== 'info'));
</script>

{#if shown.length}
  <div class="issues">
    <button
      type="button"
      class="btn ghost"
      class:has-errors={app.errorCount > 0}
      aria-expanded={open}
      aria-controls="issues-panel"
      onclick={() => (open = !open)}
    >
      <Icon name="alert" />
      {app.errorCount ? `${app.errorCount} errors` : ''}{app.errorCount && app.warningCount
        ? ', '
        : ''}{app.warningCount ? `${app.warningCount} warnings` : ''}
    </button>
    {#if open}
      <div id="issues-panel" class="panel" role="region" aria-label="Validation issues">
        <ul>
          {#each shown as i, k (k)}
            <li class={i.severity}>
              <strong>{i.severity}</strong>
              {i.message}
              {#if i.file}<span class="mono muted">{i.file}{i.pointer ?? ''}</span>{/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .issues {
    position: relative;
  }
  .has-errors {
    color: var(--danger);
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    width: min(480px, 90vw);
    max-height: 60vh;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 4px 16px var(--shadow-color);
    padding: var(--space-3);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: 13px;
  }
  li strong {
    font-size: 11px;
    text-transform: uppercase;
    margin-right: var(--space-1);
  }
  li.error strong {
    color: var(--danger);
  }
  li.warning strong {
    color: var(--warn);
  }
  li .mono {
    display: block;
    font-size: 11px;
  }
</style>
