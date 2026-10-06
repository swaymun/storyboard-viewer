<script lang="ts">
  // A shot's sound (Audio section of the shot card and the Board inspector; replaces the
  // Timeline tab): its lines with their cues, sounds on the whole shot, the waveform trim editor
  // and the selected cue's properties. Fast split of one recording across lines: pick a line,
  // P play, I / O mark, A assign → the next line (also in the next shot) is selected and its
  // segment starts where this one ended.
  import {
    isLineTarget,
    isRangeTarget,
    isShotTarget,
    type Shot,
    type ShotRef,
  } from '@storyboard-viewer/format';
  import { tick } from 'svelte';
  import { audio, cueName, lineLabel } from '../lib/audio-editor.svelte';
  import { app } from '../lib/state.svelte';
  import { ui } from '../lib/ui.svelte';
  import AudioTrim from './AudioTrim.svelte';
  import CueDetail from './CueDetail.svelte';
  import Icon from './Icon.svelte';

  let {
    entry,
    label,
    collapsible = true,
  }: {
    entry: { ref: ShotRef; shot: Shot; index: number };
    label: string;
    collapsible?: boolean;
  } = $props();

  const ref = $derived(entry.ref);
  const id = $derived(entry.shot.id);
  let root = $state<HTMLElement>();
  const open = $derived(!collapsible || audio.sectionOpen);

  const lineSet = $derived(new Set(ref.lines));
  /** Cues of the whole shot (and ranges touching its lines). */
  const shotCues = $derived(
    audio.cues.filter(
      (c) =>
        (isShotTarget(c.target) && c.target.shot === id) ||
        (isRangeTarget(c.target) && c.target.range.some((l) => lineSet.has(l))),
    ),
  );
  const count = $derived(
    shotCues.length +
      audio.cues.filter((c) => isLineTarget(c.target) && lineSet.has(c.target.line)).length,
  );
  /** The selected cue belongs here (a line of this shot or the shot itself). */
  const ownsCue = $derived(
    !!audio.cue &&
      ((isLineTarget(audio.cue.target) && lineSet.has(audio.cue.target.line)) ||
        shotCues.some((c) => c.id === audio.selectedCue)),
  );
  const cueLength = (c: { in?: number; out?: number; asset: string }) =>
    Math.max(0, (c.out ?? app.assets.get(c.asset)?.duration ?? 0) - (c.in ?? 0));

  // Auto-advance (A) moved to a line of this shot: give its row focus so keys keep working.
  $effect(() => {
    const f = audio.focusLine;
    if (!f || !lineSet.has(f) || !open) return;
    void tick().then(() => {
      const el = root?.querySelector<HTMLElement>(`[data-audio-line="${CSS.escape(f)}"]`);
      if (!el) return;
      el.focus();
      if (audio.focusLine === f) audio.focusLine = null;
    });
  });

  function toggle() {
    audio.sectionOpen = !audio.sectionOpen;
  }

  async function addSound() {
    const asset = await ui.pickAsset(['audio', 'video'], `Add a sound to ${label}`);
    if (asset) audio.addCueFrom(asset, { shot: id }, 'shot');
  }

  function onkeydown(e: KeyboardEvent) {
    if (audio.onKey(e)) audio.scope = 'shot';
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="audio"
  class:open
  aria-label="Audio of {label}"
  data-audio-section={id}
  data-tour="shot-audio"
  bind:this={root}
  {onkeydown}
>
  {#if collapsible}
    <button
      type="button"
      class="sec-head"
      aria-expanded={open}
      aria-controls="audio-body-{id}"
      onclick={toggle}
    >
      <Icon name={open ? 'down' : 'next'} size={12} />
      <span class="eyebrow">Audio</span>
      {#if count}<span class="count mono">{count}</span>{/if}
    </button>
  {/if}
  {#if open}
    <div class="body" id="audio-body-{id}">
      {#if ref.lines.length}
        <div class="lines" data-audio-lines role="group" aria-label="Lines of {label}">
          {#each ref.lines as l (l)}
            {@const lc = audio.cuesByLine.get(l) ?? []}
            <div class="line" class:selected={app.selectedLine === l}>
              <button
                type="button"
                class="lt"
                data-audio-line={l}
                aria-pressed={app.selectedLine === l}
                tabindex={app.selectedLine === l ||
                (!lineSet.has(app.selectedLine ?? '') && l === ref.lines[0])
                  ? 0
                  : -1}
                title={lineLabel(l, 200)}
                onclick={() => audio.pickLine(l)}>{lineLabel(l, 60)}</button
              >
              {#each lc as c (c.id)}
                <button
                  type="button"
                  class="badge mono"
                  class:active={audio.selectedCue === c.id}
                  data-cue-id={c.id}
                  aria-label="Cue {cueName(c)} ({c.track ?? 'default'})"
                  title="{cueName(c)} · {c.track ?? 'default'}"
                  onclick={() => {
                    app.selectLine(l, { withShot: true });
                    audio.selectCue(c.id, 'shot');
                  }}
                  >{c.track === 'dialogue' || !c.track
                    ? `${cueLength(c).toFixed(1)}s`
                    : c.track}</button
                >
              {/each}
            </div>
          {/each}
        </div>
      {/if}
      {#if shotCues.length}
        <ul class="shot-cues" aria-label="Sounds on the whole shot">
          {#each shotCues as c (c.id)}
            <li>
              <button
                type="button"
                class="sc"
                class:active={audio.selectedCue === c.id}
                data-cue-id={c.id}
                onclick={() => audio.selectCue(c.id, 'shot')}
              >
                <Icon name={c.gain === 0 ? 'mute' : 'volume'} size={11} />
                <span class="cn">{cueName(c)}</span>
                <span class="tr">{c.track ?? 'default'}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if audio.scope === 'shot' || !ui.soundtrackOpen}
        <AudioTrim mode="line" />
      {:else}
        <button type="button" class="btn ghost tiny" onclick={() => (audio.scope = 'shot')}
          >Split a recording across these lines</button
        >
      {/if}
      {#if ownsCue}
        <CueDetail shotId={id} />
      {/if}
      {#if app.canEdit}
        <div class="actions">
          <button type="button" class="btn ghost tiny" id="add-shot-sound" onclick={addSound}
            ><Icon name="plus" size={11} /> Sound on the whole shot</button
          >
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .audio {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .sec-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
    font: inherit;
    color: var(--fg-muted);
    background: none;
    border: 0;
    cursor: pointer;
    text-align: left;
  }
  .sec-head:hover {
    color: var(--fg);
  }
  .count {
    font-size: 10.5px;
    color: var(--fg-muted);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .lines {
    display: flex;
    flex-direction: column;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    border-radius: var(--radius-sm);
  }
  .line.selected {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .lt {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    font-family: var(--font-script);
    font-size: 11.5px;
    color: var(--fg-2);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .line:not(.selected) .lt:hover {
    background: var(--surface-2);
  }
  .line.selected .lt {
    color: var(--fg);
  }
  .badge {
    flex: none;
    font-size: 10px;
    padding: 0 5px;
    color: var(--accent-text);
    background: var(--accent-soft);
    border: 1px solid transparent;
    border-radius: 999px;
    cursor: pointer;
  }
  .badge.active {
    border-color: var(--accent);
  }
  .shot-cues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sc {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 2px 6px;
    font: inherit;
    font-size: 12px;
    color: var(--fg-2);
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .sc:hover {
    background: var(--surface-2);
  }
  .sc.active {
    border-color: var(--accent);
  }
  .cn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tr {
    font-size: 11px;
    color: var(--fg-muted);
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .btn.tiny {
    padding: 1px 6px;
    font-size: 11.5px;
    gap: 3px;
  }
</style>
