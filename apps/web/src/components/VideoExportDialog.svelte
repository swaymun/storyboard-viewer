<script lang="ts">
  import {
    canExportVideo,
    exportAnimatic,
    type AnimaticExportOptions,
    type AnimaticExportResult,
  } from '../lib/animatic-export';
  import { downloadBlob } from '../lib/sources/local';
  import { player } from '../lib/player.svelte';
  import { app } from '../lib/state.svelte';
  import Dialog from './Dialog.svelte';
  import Segmented from './Segmented.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let height = $state<AnimaticExportOptions['height']>(720);
  let fps = $state(24);
  let captions = $state(true);
  let audio = $state(true);
  let running = $state(false);
  let fraction = $state(0);
  let stage = $state('');
  let error = $state('');
  let result = $state.raw<AnimaticExportResult | null>(null);
  let controller: AbortController | null = null;
  const supported = canExportVideo();

  $effect(() => {
    if (open && !running) {
      fps = Math.min(30, Math.round(app.project?.manifest.fps ?? 24));
      error = '';
    }
  });

  const fileName = $derived(`${app.exportStem}-animatic.${result?.ext ?? 'mp4'}`);

  async function start() {
    if (running || !app.project) return;
    player.pause();
    running = true;
    error = '';
    result = null;
    fraction = 0;
    controller = new AbortController();
    try {
      const r = await exportAnimatic(
        {
          project: app.project,
          url: (src) => app.mediaUrl(src),
          signal: controller.signal,
          onProgress: (f, s) => {
            fraction = f;
            stage = s;
          },
        },
        { height, fps, captions, audio },
      );
      result = r;
      download();
      for (const w of r.warnings) app.toast(w, { kind: 'info' });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = (e as Error).message;
    } finally {
      running = false;
      controller = null;
    }
  }

  function download() {
    if (result) downloadBlob(result.blob, fileName);
  }

  function cancel() {
    controller?.abort();
  }

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
</script>

<Dialog
  bind:open
  title="Export animatic video"
  id="video-dialog"
  width={480}
  onsubmit={start}
  onclose={cancel}
>
  {#if !supported}
    <p role="alert">
      This browser cannot encode video. Use a recent Chrome, Edge or Safari (WebCodecs).
    </p>
  {:else}
    <p class="muted note">
      Plays the story as a video: each shot's image, the storyboard's sound, and optional captions
      of the current line. Everything happens on this computer.
    </p>
    <div class="row">
      <div class="field">
        Quality
        <Segmented
          id="video-height"
          label="Quality"
          bind:value={height}
          disabled={running}
          options={[
            { value: 480, label: '480p (small)' },
            { value: 720, label: '720p' },
            { value: 1080, label: '1080p' },
          ]}
        />
      </div>
      <div class="field">
        Frames per second
        <Segmented
          id="video-fps"
          label="Frames per second"
          bind:value={fps}
          disabled={running}
          options={[12, 24, 25, 30].map((n) => ({ value: n, label: String(n) }))}
        />
      </div>
    </div>
    <label class="check"
      ><input id="video-captions" type="checkbox" bind:checked={captions} disabled={running} /> Burn in
      captions (current script line)</label
    >
    <label class="check"
      ><input id="video-audio" type="checkbox" bind:checked={audio} disabled={running} /> Include sound</label
    >
    {#if running}
      <div class="progress" role="status" aria-live="polite">
        <progress id="video-progress" max="1" value={fraction}></progress>
        <span>{stage} · {Math.round(fraction * 100)}%</span>
      </div>
    {/if}
    {#if result && !running}
      <p class="done" role="status" id="video-done">
        Done: {result.ext.toUpperCase()} ({result.codecs}), {result.duration.toFixed(1)} s, {mb(
          result.blob.size,
        )}.
        <button type="button" class="btn small" onclick={download}>Download again</button>
      </p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
  {#snippet footer()}
    {#if running}
      <button type="button" class="btn" id="video-cancel" onclick={cancel}>Cancel</button>
    {:else}
      <button type="button" class="btn" onclick={() => (open = false)}>Close</button>
      <button type="submit" class="btn primary" id="video-export" disabled={!supported}
        >{result ? 'Export again' : 'Export'}</button
      >
    {/if}
  {/snippet}
</Dialog>

<style>
  .note {
    margin: 0;
    font-size: 12px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  progress {
    width: 100%;
    accent-color: var(--accent);
  }
  .done {
    margin: 0;
    font-size: 13px;
  }
  .error {
    color: var(--danger);
    margin: 0;
  }
  .btn.small {
    padding: 3px 10px;
    font-size: 12px;
  }
</style>
