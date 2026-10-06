<script lang="ts">
  // Properties of the selected cue (shared audio editor): what it plays on, track (free text
  // with suggestions), gain and mute, fades, offset, loop; delete. Commits on change.
  import { tooltip } from '../lib/tooltip';
  import {
    isGlobalTarget,
    isLineTarget,
    isRangeTarget,
    isShotTarget,
    type CueTarget,
  } from '@storyboard-viewer/format';
  import { audio, cueName, targetLabel } from '../lib/audio-editor.svelte';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import SuggestInput from './SuggestInput.svelte';

  /** The shot whose card shows this (retargeting "Shot" uses it). */
  let { shotId = null }: { shotId?: string | null } = $props();

  const cue = $derived(audio.cue);
  const editable = $derived(app.canEdit);
  const num = (e: Event) => Number((e.target as HTMLInputElement).value);
  const kind = $derived(
    !cue
      ? null
      : isLineTarget(cue.target)
        ? 'line'
        : isShotTarget(cue.target)
          ? 'shot'
          : isRangeTarget(cue.target)
            ? 'range'
            : 'global',
  );
  const muted = $derived(cue?.gain === 0);

  function retarget(k: 'line' | 'shot' | 'global') {
    const c = cue;
    if (!c || k === kind) return;
    const owner = (line: string) => app.project?.ids.shots.find((s) => s.lines.includes(line))?.id;
    const curLine = isLineTarget(c.target)
      ? c.target.line
      : isRangeTarget(c.target)
        ? c.target.range[0]
        : null;
    const shot =
      shotId ??
      (isShotTarget(c.target) ? c.target.shot : null) ??
      (curLine ? owner(curLine) : null) ??
      app.selectedShot ??
      app.shots[0]?.ref.id;
    const line =
      app.selectedLine ??
      curLine ??
      app.project?.ids.shots.find((s) => s.id === shot)?.lines[0] ??
      app.project?.ids.lines[0]?.id;
    let target: CueTarget | null = null;
    if (k === 'line' && line) target = { line };
    else if (k === 'shot' && shot) target = { shot };
    else if (k === 'global') target = { global: { start: 0 } };
    if (target) audio.patchCue('Change cue target', { target });
  }
</script>

{#if cue}
  <section class="cue-panel" aria-label="Cue {cueName(cue)}" data-cue-id={cue.id}>
    <header>
      {#if editable}
        <input
          class="name"
          aria-label="Cue label"
          value={cue.label ?? ''}
          placeholder={app.assets.get(cue.asset)?.name ?? cue.asset}
          onchange={(e) =>
            audio.patchCue('Rename cue', {
              label: (e.target as HTMLInputElement).value.trim() || null,
            })}
        />
      {:else}
        <span class="name">{cueName(cue)}</span>
      {/if}
      {#if editable}
        <button
          type="button"
          class="btn ghost icon"
          id="delete-cue"
          aria-label="Delete cue"
          {@attach tooltip('Delete cue', 'Delete')}
          onclick={() => audio.deleteCue()}><Icon name="trash" size={13} /></button
        >
      {/if}
      <button
        type="button"
        class="btn ghost icon"
        aria-label="Close cue"
        {@attach tooltip('Close', 'Esc')}
        onclick={() => audio.clear()}><Icon name="close" size={13} /></button
      >
    </header>
    <p class="target muted">
      {kind === 'range' ? 'Lines ' : kind === 'line' ? 'Line: ' : ''}{targetLabel(cue.target, 40)}
    </p>
    <fieldset disabled={!editable}>
      <div class="pair">
        <span class="k">Plays on</span>
        <div class="seg" role="group" aria-label="Plays on">
          <button type="button" aria-pressed={kind === 'line'} onclick={() => retarget('line')}
            >Line</button
          >
          <button type="button" aria-pressed={kind === 'shot'} onclick={() => retarget('shot')}
            >Shot</button
          >
          <button type="button" aria-pressed={kind === 'global'} onclick={() => retarget('global')}
            >Story</button
          >
        </div>
      </div>
      {#if isGlobalTarget(cue.target)}
        <label class="pair"
          ><span class="k">Starts at</span>
          <input
            type="number"
            min="0"
            step="0.1"
            class="n"
            value={cue.target.global.start ?? 0}
            onchange={(e) =>
              audio.patchCue('Change cue start', { target: { global: { start: num(e) } } })}
          /></label
        >
      {/if}
      <div class="pair">
        <span class="k">Track</span>
        <SuggestInput
          class="track"
          label="Track"
          value={cue.track ?? 'default'}
          suggestions={audio.trackNames}
          disabled={!editable}
          oncommit={(v) => {
            if (v !== (cue.track ?? 'default'))
              audio.patchCue('Change track', { track: v || null });
          }}
        />
      </div>
      <div class="pair">
        <span class="k">Gain</span>
        <div class="gain">
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            aria-label="Cue gain"
            value={cue.gain ?? 1}
            style:--fill="{((cue.gain ?? 1) / 2) * 100}%"
            oninput={(e) =>
              audio.patchCue('Change gain', { gain: num(e) === 1 ? null : num(e) }, 'gain')}
          />
          <span class="mono v">{(cue.gain ?? 1).toFixed(2)}</span>
          <button
            type="button"
            class="btn ghost icon"
            aria-pressed={muted}
            aria-label={muted ? 'Unmute cue' : 'Mute cue'}
            {@attach tooltip(muted ? 'Unmute' : 'Mute (gain 0)')}
            onclick={() =>
              audio.patchCue(muted ? 'Unmute cue' : 'Mute cue', { gain: muted ? null : 0 })}
            ><Icon name={muted ? 'mute' : 'volume'} size={13} /></button
          >
        </div>
      </div>
      <div class="nums">
        <label
          ><span class="k">Fade in</span><input
            type="number"
            min="0"
            step="0.1"
            class="n"
            value={cue.fade_in ?? 0}
            onchange={(e) => audio.patchCue('Change fade', { fade_in: num(e) || null })}
          /></label
        >
        <label
          ><span class="k">Fade out</span><input
            type="number"
            min="0"
            step="0.1"
            class="n"
            value={cue.fade_out ?? 0}
            onchange={(e) => audio.patchCue('Change fade', { fade_out: num(e) || null })}
          /></label
        >
        <label
          ><span class="k">Offset</span><input
            type="number"
            step="0.05"
            class="n"
            value={cue.offset ?? 0}
            onchange={(e) => audio.patchCue('Change offset', { offset: num(e) || null })}
          /></label
        >
      </div>
      <label class="check"
        ><input
          type="checkbox"
          checked={!!cue.loop}
          onchange={(e) =>
            audio.patchCue('Toggle loop', {
              loop: (e.target as HTMLInputElement).checked || null,
            })}
        /> Loop until the story ends</label
      >
    </fieldset>
  </section>
{/if}

<style>
  .cue-panel {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: var(--surface-2);
    border-radius: var(--radius);
    font-size: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 12.5px;
  }
  input.name {
    padding: 1px 4px;
    background: transparent;
    border-color: transparent;
  }
  input.name:hover {
    border-color: var(--border);
  }
  .btn.icon {
    width: 22px;
    height: 22px;
    padding: 3px;
  }
  .target {
    margin: 0;
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .pair {
    display: grid;
    grid-template-columns: 64px 1fr;
    align-items: center;
    gap: 6px;
  }
  .k {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .seg {
    display: inline-flex;
    justify-self: start;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .seg button {
    font: inherit;
    font-size: 11.5px;
    padding: 1px 8px;
    color: var(--fg-muted);
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .seg button + button {
    border-left: 1px solid var(--border-strong);
  }
  .seg button[aria-pressed='true'] {
    color: var(--fg);
    background: var(--surface-3);
  }
  .gain {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .gain input {
    flex: 1;
    min-width: 40px;
  }
  .v {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .nums {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .nums label {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .n {
    width: 100%;
    padding: 1px 4px !important;
    font-size: 12px !important;
  }
  .pair :global(.track input) {
    padding: 1px 4px;
    font-size: 12px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-2);
  }
</style>
