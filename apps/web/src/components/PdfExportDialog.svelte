<script lang="ts">
  import { DEFAULT_PRINT, PER_PAGE, type PrintOptions } from '../lib/print';
  import { app } from '../lib/state.svelte';
  import Dialog from './Dialog.svelte';
  import Segmented from './Segmented.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let opts = $state<PrintOptions>({ ...DEFAULT_PRINT });

  $effect(() => {
    if (open) opts = { ...(app.print ?? loadSaved()) };
  });

  function loadSaved(): PrintOptions {
    try {
      const v = localStorage.getItem('sbd:print');
      return v ? { ...DEFAULT_PRINT, ...(JSON.parse(v) as Partial<PrintOptions>) } : DEFAULT_PRINT;
    } catch {
      return DEFAULT_PRINT;
    }
  }

  function apply() {
    try {
      localStorage.setItem('sbd:print', JSON.stringify(opts));
    } catch {
      /* ignore */
    }
    app.openPrint({ ...opts });
    open = false;
  }
</script>

<Dialog bind:open title="Export PDF" id="pdf-dialog" width={520} onsubmit={apply}>
  <fieldset>
    <legend>Layout</legend>
    <label class="check"
      ><input type="radio" name="layout" value="grid" bind:group={opts.layout} /> Grid of frames (landscape)</label
    >
    {#if opts.layout === 'grid'}
      <div class="field indent">
        Shots per page
        <Segmented
          id="pdf-per-page"
          label="Shots per page"
          bind:value={opts.perPage}
          options={PER_PAGE.map((n) => ({ value: n, label: String(n) }))}
        />
      </div>
    {/if}
    <label class="check"
      ><input type="radio" name="layout" value="rows" bind:group={opts.layout} /> One row per shot, script
      beside the image (portrait)</label
    >
  </fieldset>
  <fieldset>
    <legend>Include</legend>
    <label class="check"><input type="checkbox" bind:checked={opts.titlePage} /> Title page</label>
    <label class="check"><input type="checkbox" bind:checked={opts.lines} /> Script lines</label>
    <label class="check"
      ><input type="checkbox" bind:checked={opts.fields} /> Shot details (camera, movement…)</label
    >
    <label class="check"><input type="checkbox" bind:checked={opts.notes} /> Notes</label>
  </fieldset>
  <div class="field">
    Paper
    <Segmented
      id="pdf-paper"
      label="Paper"
      bind:value={opts.paper}
      options={[
        { value: 'letter', label: 'US Letter' },
        { value: 'a4', label: 'A4' },
      ]}
    />
  </div>
  <p class="muted note">
    Opens a print preview. Choose <strong>Save as PDF</strong> in the print dialog. From a terminal:
    <code>sbd export-pdf my-story.sbd</code>.
  </p>
  {#snippet footer()}
    <button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
    <button type="submit" class="btn primary" id="pdf-preview">Preview</button>
  {/snippet}
</Dialog>

<style>
  .indent {
    margin-left: 24px;
    max-width: 160px;
  }
  .note {
    margin: 0;
    font-size: 12px;
  }
</style>
