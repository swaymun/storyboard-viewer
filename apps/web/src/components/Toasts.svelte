<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { updateNotice } from '../lib/update-notice.svelte';
  import Icon from './Icon.svelte';
</script>

<div class="toasts" role="region" aria-label="Notifications" aria-live="polite">
  {#if updateNotice.show}
    <!-- a new version of the app is waiting (lib/sw-update.ts); Reload saves first -->
    <div class="toast update" role="status" id="update-toast" data-toast="update">
      <Icon name="refresh" size={14} />
      <span class="msg">A new version is ready</span>
      <button
        type="button"
        class="btn small primary"
        id="update-reload"
        disabled={updateNotice.busy}
        title={app.unsaved
          ? 'Saves your changes, then loads the new version'
          : 'Loads the new version'}
        onclick={() => void updateNotice.reload()}>Reload</button
      >
      <button
        type="button"
        class="btn ghost icon x"
        aria-label="Later"
        title="Later"
        onclick={() => (updateNotice.show = false)}><Icon name="close" size={14} /></button
      >
    </div>
  {/if}
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'} data-toast={t.kind}>
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button
          type="button"
          class="btn small"
          onclick={() => {
            t.action!.run();
            app.dismissToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button
        type="button"
        class="btn ghost icon x"
        aria-label="Dismiss"
        onclick={() => app.dismissToast(t.id)}><Icon name="close" size={14} /></button
      >
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: var(--space-4);
    bottom: 64px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    pointer-events: none;
    max-width: min(440px, calc(100vw - 32px));
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px 6px 6px 12px;
    font-size: 13px;
    background: var(--surface);
    color: var(--fg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow:
      0 1px 2px var(--shadow-color),
      0 6px 20px var(--shadow-color);
  }
  .toast.error {
    border-color: color-mix(in srgb, var(--danger) 50%, var(--border-strong));
  }
  .toast.error .msg {
    color: var(--danger);
  }
  .toast.update {
    border-color: var(--accent);
  }
  .toast.update :global(svg:first-child) {
    flex: none;
    color: var(--accent-text);
  }
  .toast.agent {
    border-color: var(--accent);
  }
  .msg {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .btn.small {
    padding: 2px 10px;
    font-size: 12px;
  }
  .x {
    width: 26px;
    height: 26px;
  }
</style>
