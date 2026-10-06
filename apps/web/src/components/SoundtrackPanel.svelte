<script lang="ts">
  // Soundtrack panel (View → Soundtrack, or the playback bar): everything that is not a shot's
  // own sound. Story-wide cues (music under everything, ambience) with the trim editor, and all
  // cues on their tracks in story time with per-track mute (preview), solo (preview), gain and
  // "muted in the storyboard" (saved). Clicking a shot's cue opens it in that shot's card.
  import { tooltip } from '../lib/tooltip';
  import {
    isGlobalTarget,
    isLineTarget,
    isShotTarget,
    updateTrack,
    type Cue,
  } from '@storyboard-viewer/format';
  import { audio, cueName, targetLabel } from '../lib/audio-editor.svelte';
  import { isContextMenuKey, sep } from '../lib/menu';
  import { formatTime, player } from '../lib/player.svelte';
  import { app } from '../lib/state.svelte';
  import { ui } from '../lib/ui.svelte';
  import AudioTrim from './AudioTrim.svelte';
  import CueDetail from './CueDetail.svelte';
  import Icon from './Icon.svelte';

  /** Shown under the animatic picture (in the stage) instead of above the playback bar. */
  let { docked = false }: { docked?: boolean } = $props();

  const editable = $derived(app.canEdit);
  const inShot = $derived(new Set(app.project?.ids.shots.flatMap((s) => s.lines) ?? []));
  /** Cues that belong to no shot card: whole-story cues and cues on lines outside any shot. */
  const storyCues = $derived(
    audio.cues.filter(
      (c) => isGlobalTarget(c.target) || (isLineTarget(c.target) && !inShot.has(c.target.line)),
    ),
  );
  const anim = $derived(player.animatic);
  const range = $derived<[number, number]>([0, Math.max(anim.duration, 0.1)]);
  const pct = (t: number) => ((t - range[0]) / (range[1] - range[0])) * 100;
  const trackDefs = $derived(new Map((app.project?.timeline.tracks ?? []).map((t) => [t.id, t])));
  const lanes = $derived(
    player.tracks.map((t) => ({
      ...t,
      def: trackDefs.get(t.id),
      cues: anim.cues.filter((c) => c.track === t.id),
    })),
  );
  const byId = $derived(new Map(audio.cues.map((c) => [c.id, c])));
  const showEditor = $derived(audio.scope === 'story');

  /** Opens a cue where it is edited: its shot's card, or here. */
  function openCue(c: Cue | undefined) {
    if (!c) return;
    const t = c.target;
    const shot = isShotTarget(t)
      ? t.shot
      : isLineTarget(t)
        ? app.project?.ids.shots.find((s) => s.lines.includes(t.line))?.id
        : 'range' in t
          ? app.project?.ids.shots.find((s) => s.lines.includes(t.range[0]))?.id
          : undefined;
    if (!shot) return audio.selectCue(c.id, 'story');
    if (isLineTarget(t)) app.selectLine(t.line, { withShot: true });
    else app.selectShot(shot, { scroll: true });
    audio.sectionOpen = true;
    audio.selectCue(c.id, 'shot');
  }

  async function addStorySound() {
    const id = await ui.pickAsset(['audio', 'video'], 'Add music or a sound under the story');
    if (id) audio.addCueFrom(id, { global: { start: 0 } }, 'story');
  }

  function seekLane(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    player.seek(range[0] + ((e.clientX - r.left) / r.width) * (range[1] - range[0]));
  }

  function saveMute(id: string, muted: boolean) {
    app.edit(muted ? 'Unmute track' : 'Mute track', (p) =>
      updateTrack(p, id, { muted: muted ? null : true }),
    );
  }

  function laneMenu(e: MouseEvent | KeyboardEvent, t: (typeof lanes)[number]) {
    ui.openContextMenu(
      e,
      [
        {
          label: player.muted.has(t.id) ? 'Unmute while previewing' : 'Mute while previewing',
          onSelect: () => player.toggleTrack(t.id),
        },
        {
          label: player.solo.has(t.id) ? 'Unsolo' : 'Solo',
          onSelect: () => player.toggleSolo(t.id),
        },
        sep(),
        {
          label: 'Muted in the storyboard (saved)',
          checked: !!t.def?.muted,
          disabled: !editable,
          onSelect: () => saveMute(t.id, !!t.def?.muted),
        },
      ],
      `Track ${t.label}`,
    );
  }

  const num = (e: Event) => Number((e.target as HTMLInputElement).value);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="soundtrack"
  class:docked
  id="soundtrack"
  data-tour="soundtrack"
  aria-labelledby="soundtrack-title"
  onkeydown={(e) => {
    if (e.key === 'Escape' && !audio.selectedCue && audio.markIn === null) {
      ui.soundtrackOpen = false;
      document.getElementById('soundtrack-toggle')?.focus();
      return;
    }
    if (audio.onKey(e)) audio.scope = 'story';
  }}
>
  <header>
    <h2 id="soundtrack-title">Soundtrack</h2>
    <span class="muted hint">Music and sounds under the whole story, and all tracks.</span>
    <button
      type="button"
      class="btn ghost icon"
      aria-label="Close soundtrack"
      onclick={() => (ui.soundtrackOpen = false)}><Icon name="close" size={14} /></button
    >
  </header>
  <div class="cols">
    <div class="left">
      <ul class="story-cues" aria-label="Story-wide sounds">
        {#each storyCues as c (c.id)}
          <li>
            <button
              type="button"
              class="sc"
              class:active={audio.selectedCue === c.id}
              data-cue-id={c.id}
              onclick={() => audio.selectCue(c.id, 'story')}
            >
              <Icon name={c.gain === 0 ? 'mute' : 'volume'} size={12} />
              <span class="cn">{cueName(c)}</span>
              <span class="tg muted">{targetLabel(c.target, 30)}</span>
              <span class="tr muted">{c.track ?? 'default'}</span>
            </button>
          </li>
        {:else}
          <li class="muted none">No story-wide sounds yet.</li>
        {/each}
      </ul>
      {#if editable}
        <div class="row">
          <button type="button" class="btn ghost tiny" id="add-story-sound" onclick={addStorySound}
            ><Icon name="plus" size={12} /> Music or sound under the story</button
          >
          {#if !showEditor}
            <button type="button" class="btn ghost tiny" onclick={() => (audio.scope = 'story')}
              >Trim a recording…</button
            >
          {/if}
        </div>
      {/if}

      <div class="tracks" role="group" aria-label="Tracks">
        <div class="ruler" aria-hidden="true">
          <div class="head"></div>
          <div class="lane-area">
            {#each anim.shots as s, i (s.id)}
              <span class="shot-mark" style:left="{Math.max(0, pct(s.start))}%">{i + 1}</span>
            {/each}
            <span class="playhead" style:left="{pct(player.time)}%"></span>
          </div>
        </div>
        {#each lanes as t (t.id)}
          <div class="lane" data-track={t.id}>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="head"
              oncontextmenu={(e) => laneMenu(e, t)}
              onkeydown={(e) => isContextMenuKey(e) && laneMenu(e, t)}
            >
              <button
                type="button"
                class="ms"
                aria-pressed={player.muted.has(t.id)}
                aria-label="Mute {t.label}"
                {@attach tooltip('Mute while previewing', 'not saved')}
                onclick={() => player.toggleTrack(t.id)}
                ><Icon name={player.muted.has(t.id) ? 'mute' : 'volume'} size={12} /></button
              >
              <span class="tname" class:saved-mute={!!t.def?.muted}>{t.label}</span>
              <button
                type="button"
                class="ms solo"
                aria-pressed={player.solo.has(t.id)}
                aria-label="Solo track {t.label}"
                {@attach tooltip('Solo', 'preview only')}
                onclick={() => player.toggleSolo(t.id)}>S</button
              >
              <button
                type="button"
                class="ms save"
                aria-pressed={!!t.def?.muted}
                aria-label="Mute track {t.label}"
                {@attach tooltip('Muted in the storyboard', 'saved')}
                disabled={!editable}
                onclick={() => saveMute(t.id, !!t.def?.muted)}>M</button
              >
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={t.def?.gain ?? 1}
                style:--fill="{((t.def?.gain ?? 1) / 2) * 100}%"
                disabled={!editable}
                aria-label="Gain of track {t.label}"
                {@attach tooltip(`Track gain ${(t.def?.gain ?? 1).toFixed(2)}`)}
                oninput={(e) =>
                  app.edit(
                    'Track gain',
                    (p) => updateTrack(p, t.id, { gain: num(e) === 1 ? null : num(e) }),
                    { coalesce: `track:${t.id}:gain` },
                  )}
              />
            </div>
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="lane-area" onclick={seekLane}>
              {#each t.cues as c (c.id)}
                {@const full = byId.get(c.id)}
                <button
                  type="button"
                  class="block"
                  class:selected={audio.selectedCue === c.id}
                  class:muted-track={!!t.def?.muted}
                  data-cue-id={c.id}
                  style:left="{Math.max(0, pct(c.start))}%"
                  style:width="{Math.max(
                    0.4,
                    pct(Math.min(c.end, range[1])) - Math.max(0, pct(c.start)),
                  )}%"
                  {@attach tooltip(
                    `${full ? cueName(full) : c.id} · ${formatTime(c.start)}–${formatTime(c.end)}`,
                  )}
                  onclick={(e) => {
                    e.stopPropagation();
                    openCue(full);
                  }}>{full ? cueName(full) : c.id}</button
                >
              {/each}
              <span class="playhead" style:left="{pct(player.time)}%"></span>
            </div>
          </div>
        {:else}
          <p class="muted none">No cues yet.</p>
        {/each}
      </div>
    </div>
    {#if showEditor}
      <div class="right">
        <AudioTrim mode="story" height={72} />
        <CueDetail />
      </div>
    {/if}
  </div>
</section>

<style>
  .soundtrack {
    border-top: 1px solid var(--border);
    background: var(--surface);
    max-height: 42vh;
    overflow: auto;
    padding: var(--space-2) var(--space-4) var(--space-3);
  }
  /* under the animatic: the tracks first, right below the picture */
  .soundtrack.docked {
    width: 100%;
    max-height: 34vh;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .docked .left {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .docked .tracks {
    order: -1;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: 13px;
  }
  .hint {
    flex: 1;
    font-size: 12px;
  }
  .btn.icon {
    width: 24px;
    height: 24px;
    padding: 4px;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
    gap: var(--space-4);
    align-items: start;
  }
  .cols:not(:has(.right)) {
    grid-template-columns: minmax(0, 1fr);
  }
  .left,
  .right {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .story-cues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .sc {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 3px 6px;
    font: inherit;
    font-size: 12.5px;
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
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tg {
    flex: 1;
    font-size: 11.5px;
  }
  .tr {
    font-size: 11px;
  }
  .none {
    font-size: 12px;
    margin: 2px 6px;
  }
  .row {
    display: flex;
    gap: 4px;
  }
  .btn.tiny {
    padding: 1px 6px;
    font-size: 12px;
    gap: 4px;
  }
  .ruler,
  .lane {
    display: grid;
    grid-template-columns: 220px 1fr;
    align-items: center;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: var(--space-3);
    min-width: 0;
  }
  .head input[type='range'] {
    width: 64px;
  }
  .tname {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tname.saved-mute {
    color: var(--fg-muted);
    text-decoration: line-through;
  }
  .ms {
    display: grid;
    place-items: center;
    width: 22px;
    height: 20px;
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    color: var(--fg-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
  }
  .ms[aria-pressed='true'] {
    color: var(--accent-fg);
    background: var(--accent);
    border-color: var(--accent);
  }
  .ms.save[aria-pressed='true'] {
    background: var(--danger);
    border-color: var(--danger);
  }
  .ms:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .lane-area {
    position: relative;
    height: 24px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .ruler .lane-area {
    height: 16px;
    cursor: default;
  }
  .shot-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-muted);
    border-left: 1px solid var(--border-strong);
    padding-left: 3px;
  }
  .block {
    position: absolute;
    top: 3px;
    bottom: 3px;
    overflow: hidden;
    padding: 0 4px;
    font: inherit;
    font-size: 10.5px;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--fg);
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .block.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .block.muted-track {
    opacity: 0.4;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--fg);
    pointer-events: none;
  }
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: 1fr;
    }
    .ruler,
    .lane {
      grid-template-columns: 170px 1fr;
    }
  }
</style>
