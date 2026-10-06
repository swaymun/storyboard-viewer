<script lang="ts">
  // Help → Fountain syntax guide: a short cheat sheet in a closable pane on the left, so it can
  // stay open next to the script while writing. Esc (inside the pane) or × closes it; the choice
  // is remembered (ui.guideOpen).
  import { tooltip } from '../lib/tooltip';
  import { onMount } from 'svelte';
  import { MOD } from '../lib/menu';
  import { GUIDE_WIDTH, ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';

  let heading = $state<HTMLElement>();
  const mac = MOD === '⌘';

  onMount(() => {
    // opened from the Help menu: bring the guide into reach of the keyboard
    if (document.activeElement?.closest('[role="menu"], [role="menubar"]'))
      heading?.focus({ preventScroll: true });
  });

  /** Drag the pane's right edge to resize it (remembered when released). */
  function startResize(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = ui.guideWidth;
    const move = (ev: PointerEvent) => ui.setGuideWidth(w0 + ev.clientX - x0, false);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.documentElement.classList.remove('guide-resizing');
      ui.setGuideWidth(ui.guideWidth);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.documentElement.classList.add('guide-resizing');
  }

  function resizeKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') ui.setGuideWidth(ui.guideWidth - step);
    else if (e.key === 'ArrowRight') ui.setGuideWidth(ui.guideWidth + step);
    else if (e.key === 'Home') ui.setGuideWidth(GUIDE_WIDTH.min);
    else if (e.key === 'End') ui.setGuideWidth(GUIDE_WIDTH.max);
    else return;
    e.preventDefault();
  }

  function close() {
    ui.setGuide(false);
    document.getElementById('help-menu')?.focus();
  }

  const items: Array<{ title: string; text: string; example: string }> = [
    {
      title: 'Scene heading',
      text: 'A line that starts with INT., EXT., EST., INT./EXT. or I/E, with a blank line before it. Any other heading: start it with a period.',
      example: 'EXT. HARBOUR - DAWN\n\n.FLASHBACK',
    },
    {
      title: 'Action',
      text: 'Plain paragraphs describe what we see. A line in capitals that should stay action starts with !',
      example: 'Gulls scatter as the boat docks.\n!BANG. The door slams.',
    },
    {
      title: 'Character',
      text: 'The name in capitals on its own line, a blank line above and the dialogue right below. A name with lower-case letters starts with @.',
      example: 'NORA\n@McGRATH',
    },
    {
      title: 'Dialogue',
      text: 'The lines directly under the character. No blank line in between.',
      example: "NORA\nWe're late again.",
    },
    {
      title: 'Parenthetical',
      text: 'How a line is said, in brackets on its own line inside the dialogue.',
      example: "NORA\n(under her breath)\nWe're late again.",
    },
    {
      title: 'Extensions',
      text: 'After the name: (V.O.) voice-over, (O.S.) off screen, (CONT’D) continued. Two people at once: ^ after the second name.',
      example: 'NORA (V.O.)\nIt started with a letter.\n\nSAM ^\nIt did.',
    },
    {
      title: 'Transition',
      text: 'A line in capitals ending in TO:, with blank lines around it. Anything else: start it with >.',
      example: 'CUT TO:\n\n> FADE OUT.',
    },
    {
      title: 'Centered text',
      text: 'Wrap it in > and <.',
      example: '> THE END <',
    },
    {
      title: 'Lyrics',
      text: 'Start each sung line with ~.',
      example: '~Row, row, row your boat',
    },
    {
      title: 'Emphasis',
      text: 'Stars and underscores around words. Write \\* for a plain star.',
      example: '*italic*  **bold**  ***both***  _underline_',
    },
    {
      title: 'Notes',
      text: 'Double brackets: for you, not part of the script.',
      example: 'She waves. [[try a wider angle]]',
    },
    {
      title: 'Boneyard',
      text: 'Text between /* and */ is hidden (cut scenes, old drafts).',
      example: '/* The old opening\nwent here. */',
    },
    {
      title: 'Sections and synopses',
      text: '# starts a section (## a smaller one); = a one-line summary. Both are for structure only.',
      example: '# Act One\n= Nora finds the letter.',
    },
    {
      title: 'Page break',
      text: 'Three or more equals signs on a line.',
      example: '===',
    },
    {
      title: 'Title page',
      text: 'Key: value lines at the very top, then a blank line.',
      example: 'Title: The Letter\nAuthor: Nora Ash',
    },
  ];
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  class="guide"
  id="fountain-guide"
  style:width="{ui.guideWidth}px"
  aria-labelledby="guide-title"
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }}
>
  <header>
    <h2 id="guide-title" tabindex="-1" bind:this={heading}>Fountain syntax</h2>
    <button
      type="button"
      class="btn ghost icon"
      id="guide-close"
      aria-label="Close the Fountain syntax guide"
      {@attach tooltip('Close', 'Esc')}
      onclick={close}><Icon name="close" size={14} /></button
    >
  </header>
  <p class="intro muted">
    The script is plain text. These few marks tell apps what each line is; the editor formats them
    as you type.
  </p>
  <dl>
    {#each items as it (it.title)}
      <dt>{it.title}</dt>
      <dd>
        <p>{it.text}</p>
        <pre>{it.example}</pre>
      </dd>
    {/each}
  </dl>
  <h3>Keys in this editor</h3>
  <dl class="keys">
    <dt><kbd>Tab</kbd></dt>
    <dd>
      On an empty line: Character → Scene heading → Transition → Action (<kbd>⇧Tab</kbd> goes back). After
      a name or a line of dialogue: a parenthetical. On action text: capitals.
    </dd>
    <dt><kbd>Esc</kbd> then <kbd>Tab</kbd></dt>
    <dd>
      Leave the editor with the keyboard (or <kbd>{mac ? '⇧⌥M' : 'Ctrl+M'}</kbd> to make Tab move focus
      until you press it again).
    </dd>
    <dt><kbd>{MOD}↵</kbd></dt>
    <dd>Make a shot from the selected words (or the line at the cursor).</dd>
    <dt><kbd>↵ ↵</kbd></dt>
    <dd>Enter twice ends a paragraph: what you type next is outside the shot above.</dd>
  </dl>
</aside>
<!-- the pane's right edge: drag (or ←/→ when focused) to resize (a focusable separator is the
     ARIA window-splitter pattern) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="resize"
  id="guide-resize"
  role="separator"
  aria-orientation="vertical"
  aria-controls="fountain-guide"
  aria-label="Width of the Fountain guide"
  aria-valuenow={ui.guideWidth}
  aria-valuemin={GUIDE_WIDTH.min}
  aria-valuemax={GUIDE_WIDTH.max}
  tabindex="0"
  {@attach tooltip('Drag to resize')}
  onpointerdown={startResize}
  onkeydown={resizeKey}
  ondblclick={() => ui.setGuideWidth(GUIDE_WIDTH.default)}
></div>

<style>
  .guide {
    flex: none;
    overflow: auto;
    padding: var(--space-3) var(--space-4) var(--space-6);
    background: var(--surface);
    border-right: 1px solid var(--border);
    font-size: 12.5px;
    line-height: 1.45;
  }
  .resize {
    flex: none;
    position: relative;
    width: 6px;
    margin-left: -3px;
    margin-right: -3px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
  }
  .resize::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 2px;
    background: transparent;
    transition: background 120ms var(--ease);
  }
  .resize:hover::after,
  :global(html.guide-resizing) .resize::after {
    background: var(--border-strong);
  }
  .resize:focus-visible {
    outline: none;
  }
  .resize:focus-visible::after {
    background: var(--focus, var(--accent));
  }
  :global(html.guide-resizing),
  :global(html.guide-resizing *) {
    cursor: col-resize !important;
    user-select: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: calc(-1 * var(--space-3));
    padding: var(--space-1) 0;
    background: var(--surface);
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    outline: none;
  }
  h2:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: 12px;
    font-weight: 600;
  }
  .btn.icon {
    width: 24px;
    height: 24px;
    padding: 4px;
  }
  .intro {
    margin: var(--space-1) 0 var(--space-3);
  }
  dl {
    margin: 0;
  }
  dt {
    margin-top: var(--space-3);
    font-weight: 600;
    color: var(--fg);
  }
  dd {
    margin: 2px 0 0;
    color: var(--fg-2);
  }
  dd p {
    margin: 0 0 4px;
  }
  pre {
    margin: 0;
    padding: 5px 8px;
    font-family: var(--font-script);
    font-size: 12px;
    color: var(--paper-fg);
    background: var(--paper);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
  }
  .keys dt {
    font-weight: 500;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 0 3px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
</style>
