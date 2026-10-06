<script lang="ts">
  // Undo / redo, the save status and (when there is something to save) the Save button. The
  // other file commands are in the menu bar (File).
  import { tooltip } from '../lib/tooltip';
  import { MOD } from '../lib/menu';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  const mod = MOD;

  // "Unsaved changes" as soon as you type (before the typed text becomes an edit), "Saving…"
  // while writing, "Saved" only once everything is on disk.
  const status = $derived.by(() => {
    if (app.saveMode === 'none') return { text: 'Read-only', tone: 'muted' };
    if (app.saving) return { text: 'Saving…', tone: 'muted' };
    if (app.saveError) return { text: 'Not saved', tone: 'danger' };
    if (app.unsaved) return { text: 'Unsaved changes', tone: 'warn' };
    if (app.lastSaved) return { text: 'Saved', tone: 'muted' };
    return { text: '', tone: 'muted' };
  });

  const saveLabel = $derived(
    app.saveMode === 'download'
      ? 'Download .sbd'
      : app.saveMode === 'file' && app.source?.kind === 'zip' && !app.source.inPlace
        ? 'Save .sbd…'
        : 'Save',
  );

  function howToEdit() {
    app.toast(
      `This storyboard is read-only here. You can edit a copy in the browser and save it as a new .sbd file.`,
      {
        kind: 'info',
        sticky: true,
        action: { label: 'Edit a copy', run: () => void app.editCopy() },
      },
    );
  }
</script>

<div class="save-controls" data-tour="save-status">
  {#if app.canEdit}
    <button
      type="button"
      class="btn ghost icon"
      id="undo"
      aria-label={app.undoLabel ? `Undo: ${app.undoLabel}` : 'Undo'}
      {@attach tooltip(app.undoLabel ? `Undo: ${app.undoLabel} (${mod}Z)` : 'Nothing to undo')}
      aria-keyshortcuts="Control+Z Meta+Z"
      disabled={!app.undoLabel}
      onclick={() => app.undo()}><Icon name="undo" /></button
    >
    <button
      type="button"
      class="btn ghost icon"
      id="redo"
      aria-label={app.redoLabel ? `Redo: ${app.redoLabel}` : 'Redo'}
      {@attach tooltip(
        app.redoLabel ? `Redo: ${app.redoLabel} (Shift+${mod}Z)` : 'Nothing to redo',
      )}
      aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
      disabled={!app.redoLabel}
      onclick={() => app.redo()}><Icon name="redo" /></button
    >
  {/if}
  <span
    class="status {status.tone}"
    id="save-status"
    role="status"
    aria-live="polite"
    title={app.saveError ?? app.source?.location ?? ''}
  >
    {#if app.unsaved && !app.saving}<span class="dot" aria-hidden="true"></span>{/if}{status.text}
  </span>
  {#if app.saveMode === 'none'}
    <button type="button" class="btn small" onclick={howToEdit}>How to edit</button>
  {:else if app.saveError || (app.unsaved && !(app.autosave && app.canAutosave))}
    <button
      type="button"
      class="btn small primary"
      id="save"
      disabled={app.saving}
      aria-keyshortcuts="Control+S Meta+S"
      {@attach tooltip(`${saveLabel} (${mod}S)`)}
      onclick={() => void app.save()}>{saveLabel}</button
    >
  {/if}
</div>

<style>
  .save-controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    white-space: nowrap;
    padding: 0 var(--space-2);
    color: var(--fg-muted);
  }
  .status.warn {
    color: var(--fg-2);
  }
  .status.danger {
    color: var(--danger);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .btn.small {
    padding: 3px 10px;
    font-size: 12px;
  }
  .btn:disabled {
    opacity: 0.35;
  }
</style>
