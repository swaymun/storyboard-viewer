<script lang="ts">
  // Compact waveform trim editor of the shared audio editor (lib/audio-editor): the source file,
  // its waveform with cue regions and the in/out selection, transport (P), in/out marks (I/O,
  // typed seconds or dragged) and the main action: assign to the selected line (A) in a shot's
  // Audio section, or add the segment to the whole story in the Soundtrack panel.
  import { formatTime } from '../lib/player.svelte';
  import { app } from '../lib/state.svelte';
  import { audio, lineLabel, targetLabel } from '../lib/audio-editor.svelte';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';
  import Waveform, { type Region } from './Waveform.svelte';

  let { mode, height = 64 }: { mode: 'line' | 'story'; height?: number } = $props();

  const regions = $derived<Region[]>(
    audio.cues
      .filter((c) => c.asset === audio.sourceId)
      .map((c) => ({
        id: c.id,
        in: c.in ?? 0,
        out: c.out ?? (audio.sourceDuration || (c.in ?? 0) + 1),
        label: c.label ?? targetLabel(c.target),
      })),
  );

  $effect(() => audio.ensureSource());

  async function chooseSource() {
    const id = await ui.pickAsset(['audio', 'video'], 'Choose the recording to split');
    if (id) audio.setSource(id);
  }

  const optNum = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? null : Number(v);
  };
</script>

<div class="trim" data-audio-trim={mode}>
  <div class="src">
    <button
      type="button"
      class="source"
      id="audio-source"
      data-source-id={audio.sourceId}
      title="Choose another recording"
      onclick={chooseSource}
    >
      <Icon name="volume" size={12} />
      <span class="name"
        >{audio.source ? audio.source.name : 'Choose a recording…'}{audio.sourceDuration
          ? ` · ${audio.sourceDuration.toFixed(1)}s`
          : ''}</span
      >
    </button>
    <label class="zoom" title="Zoom">
      <span class="visually-hidden">Waveform zoom</span>
      <Icon name="search" size={12} />
      <input
        type="range"
        min="1"
        max="16"
        step="0.5"
        bind:value={audio.zoom}
        style:--fill="{((audio.zoom - 1) / 15) * 100}%"
      />
    </label>
  </div>
  {#if audio.source}
    <Waveform
      url={audio.sourceUrl}
      fallbackDuration={audio.sourceDuration}
      {regions}
      activeRegion={audio.selectedCue}
      markIn={audio.markIn}
      markOut={audio.markOut}
      playhead={audio.playhead}
      zoom={audio.zoom}
      {height}
      onSelectRegion={(id) => audio.selectCue(id)}
      onRange={(i, o, final) => audio.setRange(i, o, final)}
      onSeek={(t) => audio.seek(t)}
    />
    <div class="transport">
      <button
        type="button"
        class="btn tiny"
        id="preview-segment"
        aria-keyshortcuts="P"
        title="Play (P)"
        onclick={() => audio.preview(true)}
        ><Icon name={audio.previewing ? 'pause' : 'play'} size={11} />
        <span class="visually-hidden"
          >{audio.previewing
            ? 'Stop'
            : audio.markIn !== null && audio.markOut !== null
              ? 'Play segment'
              : 'Play'}</span
        ></button
      >
      <span class="mono time" aria-label="Playhead">{formatTime(audio.playhead)}</span>
      <button
        type="button"
        class="btn ghost tiny"
        aria-keyshortcuts="I"
        title="Mark in at the playhead (I)"
        onclick={() => audio.mark('in')}>I</button
      >
      <input
        id="mark-in"
        class="tc"
        type="number"
        step="0.01"
        min="0"
        aria-label="In (seconds)"
        value={audio.markIn ?? ''}
        placeholder="in"
        onchange={(e) => audio.setMark('in', optNum(e))}
      />
      <button
        type="button"
        class="btn ghost tiny"
        aria-keyshortcuts="O"
        title="Mark out at the playhead (O)"
        onclick={() => audio.mark('out')}>O</button
      >
      <input
        id="mark-out"
        class="tc"
        type="number"
        step="0.01"
        min="0"
        aria-label="Out (seconds)"
        value={audio.markOut ?? ''}
        placeholder="out"
        onchange={(e) => audio.setMark('out', optNum(e))}
      />
      {#if audio.markIn !== null && audio.markOut !== null}
        <span class="mono muted len">{(audio.markOut - audio.markIn).toFixed(2)}s</span>
      {/if}
      <span class="spacer"></span>
      {#if app.canEdit && !audio.selectedCue}
        {#if mode === 'line'}
          <button
            type="button"
            class="btn tiny primary"
            id="assign-line"
            aria-keyshortcuts="A"
            disabled={!app.selectedLine || audio.markIn === null || audio.markOut === null}
            title={app.selectedLine
              ? `Assign to: ${lineLabel(app.selectedLine)} (A)`
              : 'Select a line first'}
            onclick={() => audio.assign()}>Assign <kbd>A</kbd></button
          >
        {:else}
          <button
            type="button"
            class="btn tiny primary"
            id="add-story-cue"
            disabled={!audio.source}
            title="Add the marked segment (or the whole file) under the whole story"
            onclick={() => audio.addSegment({ global: { start: 0 } }, 'story')}>Add to story</button
          >
        {/if}
      {/if}
    </div>
  {:else}
    <p class="muted empty">
      No audio yet. Import a recording in the Assets tab, then split it into lines here.
    </p>
  {/if}
</div>

<style>
  .trim {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .src,
  .transport {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .transport {
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .source {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex: 1;
    padding: 1px 4px;
    font: inherit;
    font-size: 11.5px;
    color: var(--fg-2);
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .source:hover {
    border-color: var(--border);
  }
  .source .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--fg-muted);
  }
  .zoom input {
    width: 56px;
  }
  .btn.tiny {
    padding: 1px 6px;
    font-size: 11.5px;
    gap: 3px;
  }
  .btn.tiny kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.8;
  }
  .tc {
    width: 58px;
    padding: 1px 4px !important;
    font-family: var(--font-mono);
    font-size: 11.5px !important;
  }
  .time {
    font-size: 11px;
    color: var(--fg-muted);
    min-width: 42px;
  }
  .len {
    font-size: 10.5px;
  }
  .spacer {
    flex: 1;
  }
  .empty {
    margin: 0;
    font-size: 12px;
  }
</style>
