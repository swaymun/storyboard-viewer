<script lang="ts">
  // Script lines of one shot (or the unassigned lines) in the Board view. Lines are a listbox:
  // click or arrow keys select (used by the timeline's "assign to selected line"); Enter or
  // double-click opens the line in the Script editor; Delete removes it. Lines can be dragged
  // into another shot or to another place in a shot (Alt+↑/↓ from the keyboard); the script text
  // moves with them so script order follows shot order. IDs never change.
  import {
    placeLines,
    removeLines,
    shotSegments,
    stripEmphasis,
    type ResolvedLine,
  } from '@storyboard-viewer/format';
  import { tick } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { player } from '../lib/player.svelte';

  let {
    lineIds,
    shotId = null,
    label = 'Script lines',
  }: { lineIds: readonly string[]; shotId?: string | null; label?: string } = $props();

  const LINE_TYPE = 'application/x-sbd-line';

  interface Row {
    line: ResolvedLine | undefined;
    id: string;
    cue: string | null;
    /** The words of the line this shot covers, when it covers only part of it. */
    part: { text: string; before: boolean; after: boolean } | null;
  }

  /** This shot's part of each partly covered line (format 0.2 spans). */
  const parts = $derived.by(() => {
    const out = new Map<string, Row['part']>();
    const p = app.project;
    const ref = shotId ? p?.ids.shots.find((s) => s.id === shotId) : undefined;
    if (!p || !ref || (!ref.start && !ref.end)) return out;
    const textOf = (id: string) => (app.lines.get(id) as ResolvedLine | undefined)?.text;
    for (const seg of shotSegments(ref, textOf)) {
      if (seg.whole) continue;
      const text = textOf(seg.line) ?? '';
      out.set(seg.line, {
        text: text.slice(seg.from, seg.to).trim(),
        before: seg.from > 0,
        after: seg.to < text.length,
      });
    }
    return out;
  });

  const rows = $derived.by(() => {
    const out: Row[] = [];
    let prev: ResolvedLine | undefined;
    for (const id of lineIds) {
      const line = app.lines.get(id) as ResolvedLine | undefined;
      const el = line?.element;
      let cue: string | null = null;
      if (el?.character) {
        const sameBlock =
          prev?.element?.character === el.character && prev.element.endLine + 1 === el.startLine;
        if (!sameBlock) cue = el.extension ? `${el.character} (${el.extension})` : el.character;
      }
      const part = parts.get(id) ?? null;
      // the speaker shows only when the shot covers the start of the line
      if (part?.before) cue = null;
      out.push({ line, id, cue, part });
      prev = line;
    }
    return out;
  });

  let root = $state<HTMLDivElement>();
  let dropBefore = $state<string | null>(null);
  let dropEnd = $state(false);
  let announcement = $state('');
  const editable = $derived(app.canEdit);
  const selectedHere = $derived(
    app.selectedLine && lineIds.includes(app.selectedLine) ? app.selectedLine : null,
  );
  /** Roving tabindex: the selected line, else the first. */
  const tabStop = $derived(selectedHere ?? lineIds[0] ?? null);

  const focusLine = async (id: string) => {
    await tick();
    document.querySelector<HTMLElement>(`.script [data-line-id="${CSS.escape(id)}"]`)?.focus();
  };

  function remove(id: string) {
    const i = lineIds.indexOf(id);
    const next = lineIds[i + 1] ?? lineIds[i - 1] ?? null;
    if (app.edit('Delete line', (p) => removeLines(p, [id])) && next) {
      app.selectLine(next);
      void focusLine(next);
    }
  }

  function place(id: string, target: string, before?: string) {
    const ok = app.edit('Move line', (p) => placeLines(p, [id], target, before ? { before } : {}));
    if (ok) {
      const n = app.shots.findIndex((s) => s.ref.id === target) + 1;
      announcement = `Moved line to shot ${n}`;
      app.selectLine(id);
      void focusLine(id);
    }
  }

  /** Alt+↑/↓: one step in script order, crossing into the previous/next shot at the edges. */
  function step(id: string, delta: -1 | 1) {
    if (!shotId) return;
    const shots = app.shots.filter((s) => s.ref.lines.length || s.ref.id === shotId);
    const si = shots.findIndex((s) => s.ref.id === shotId);
    const own = shots[si]!.ref.lines;
    const i = own.indexOf(id);
    if (delta < 0) {
      if (i > 0) place(id, shotId, own[i - 1]);
      else if (si > 0) place(id, shots[si - 1]!.ref.id);
    } else if (i < own.length - 1) {
      if (i + 2 < own.length) place(id, shotId, own[i + 2]);
      else place(id, shotId);
    } else if (si < shots.length - 1) {
      const next = shots[si + 1]!.ref;
      place(id, next.id, next.lines[0]);
    }
  }

  function onLineKey(e: KeyboardEvent, row: Row, i: number) {
    const go = (j: number) => {
      const r = rows[j];
      if (!r) return;
      e.preventDefault();
      app.selectLine(r.id);
      void focusLine(r.id);
    };
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && editable && shotId) {
      e.preventDefault();
      e.stopPropagation();
      step(row.id, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Escape') app.selectLine(null);
    else if (e.key === 'Enter') {
      e.preventDefault();
      app.editLineInScript(row.id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable) {
      e.preventDefault();
      remove(row.id);
    }
  }

  function onDragStart(e: DragEvent, id: string) {
    e.dataTransfer?.setData(LINE_TYPE, id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  }

  const accepts = (e: DragEvent) => !!shotId && !!e.dataTransfer?.types.includes(LINE_TYPE);

  function onDragOverLine(e: DragEvent, id: string) {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dropBefore = id;
    dropEnd = false;
  }

  function onDragOverList(e: DragEvent) {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target === e.currentTarget) {
      dropBefore = null;
      dropEnd = true;
    }
  }

  function onDrop(e: DragEvent) {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer!.getData(LINE_TYPE);
    // the line under the pointer (dragleave from child elements may have cleared dropBefore)
    const over = (e.target as HTMLElement).closest<HTMLElement>('[data-line-id]');
    const before =
      over && lineIds.includes(over.dataset['lineId']!) ? over.dataset['lineId']! : null;
    dropBefore = null;
    dropEnd = false;
    if (!id || id === before) return;
    place(id, shotId!, before ?? undefined);
  }

  const isVo = (l: ResolvedLine | undefined) =>
    /V\.?O\.?|O\.?S\.?/i.test(l?.element?.extension ?? '');
</script>

<div class="script" bind:this={root}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="lines"
    class:drop-end={dropEnd}
    role="listbox"
    tabindex="-1"
    aria-label={label}
    data-drop-shot={shotId ?? undefined}
    ondragover={onDragOverList}
    ondragleave={(e) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
        dropBefore = null;
        dropEnd = false;
      }
    }}
    ondrop={onDrop}
  >
    {#each rows as row, i (row.id)}
      {#if row.cue}
        <p class="character" aria-hidden="true">{row.cue}</p>
      {/if}
      {#if row.line}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <p
          id="line-{row.id}"
          data-line-id={row.id}
          role="option"
          aria-selected={app.selectedLine === row.id}
          tabindex={tabStop === row.id ? 0 : -1}
          class="line {row.line.type ?? 'action'}"
          class:vo={isVo(row.line)}
          class:playing={player.lineId === row.id}
          class:selected={app.selectedLine === row.id}
          class:drop-before={dropBefore === row.id}
          draggable={editable && !!shotId}
          aria-keyshortcuts={editable ? 'Enter Delete Alt+ArrowUp Alt+ArrowDown' : 'Enter'}
          aria-label={row.line.element?.character
            ? `${row.line.element.character}${row.line.element.extension ? ` (${row.line.element.extension})` : ''}: ${stripEmphasis(row.line.text)}`
            : undefined}
          aria-current={player.lineId === row.id ? 'true' : undefined}
          title={editable
            ? 'Double-click or Enter to edit in the script · drag to move'
            : undefined}
          onclick={() => app.selectLine(row.id)}
          ondblclick={() => app.editLineInScript(row.id)}
          onkeydown={(e) => onLineKey(e, row, i)}
          ondragstart={(e) => onDragStart(e, row.id)}
          ondragover={(e) => onDragOverLine(e, row.id)}
        >
          {#if row.part}{#if row.part.before}<span class="cut" aria-hidden="true">…</span
              >{/if}{stripEmphasis(row.part.text)}{#if row.part.after}<span
                class="cut"
                aria-hidden="true">…</span
              >{/if}{:else}{stripEmphasis(row.line.text)}{/if}
        </p>
      {:else}
        <p class="line missing" data-line-id={row.id}>Missing line {row.id}</p>
      {/if}
    {/each}
  </div>
  <p class="visually-hidden" aria-live="polite">{announcement}</p>
</div>

<style>
  .script {
    font-family: var(--font-script);
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--paper-fg);
  }
  .lines {
    min-height: 1.5em;
    border-radius: var(--radius-sm);
  }
  .lines.drop-end {
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  p {
    margin: 0;
    padding: 1px 8px;
    border-radius: var(--radius-sm);
    transition: background 150ms var(--ease);
  }
  .line {
    cursor: default;
    outline-offset: 0;
  }
  .line[draggable='true'] {
    cursor: grab;
  }
  .line:hover {
    background: var(--surface-2);
  }
  .line.selected {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .line.drop-before {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .scene_heading {
    color: var(--sx-scene);
    font-weight: 700;
    text-transform: uppercase;
    margin-top: 2px;
    margin-bottom: 6px;
  }
  .action {
    margin-bottom: 6px;
  }
  .dialogue + .action,
  .parenthetical + .action {
    margin-top: 8px;
  }
  .character {
    color: var(--sx-character);
    padding-left: 30%;
    text-transform: uppercase;
    margin-top: 4px;
  }
  .parenthetical {
    padding-left: 22%;
    color: var(--sx-paren);
    font-style: italic;
  }
  .dialogue {
    color: var(--sx-dialogue);
    padding-left: 12%;
    padding-right: 10%;
    margin-bottom: 2px;
  }
  .dialogue.vo {
    font-style: italic;
  }
  .transition {
    color: var(--sx-transition);
    text-align: right;
    text-transform: uppercase;
    margin: 4px 0;
  }
  .centered {
    color: var(--sx-centered);
    text-align: center;
  }
  .lyrics {
    font-style: italic;
    padding-left: 12%;
  }
  .cut {
    color: var(--fg-muted);
  }
  .missing {
    color: var(--danger);
    font-family: var(--font-sans);
    font-size: 12px;
  }
  .playing {
    background: var(--accent-soft);
    box-shadow: inset 2px 0 0 var(--accent);
  }
</style>
