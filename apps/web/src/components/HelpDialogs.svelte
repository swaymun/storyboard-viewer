<script lang="ts">
  // Help → Keyboard shortcuts, and Help → About.
  import { MOD } from '../lib/menu';
  import { ui } from '../lib/ui.svelte';
  import Dialog from './Dialog.svelte';

  const groups: Array<{ title: string; keys: Array<[string, string]> }> = [
    {
      title: 'Everywhere',
      keys: [
        [`${MOD}S`, 'Save'],
        [`${MOD}Z / ⇧${MOD}Z`, 'Undo / redo'],
        ['Space', 'Play / pause the animatic'],
        ['J / K', 'Next / previous shot'],
        ['1 2 3', 'Story, Canvas, Assets'],
        ['⇧F10 or Menu key', 'Context menu of the focused item'],
        ['F10', 'Go to the menu bar (then ← → ↓, Esc)'],
        ['?', 'This list'],
      ],
    },
    {
      title: 'Script',
      keys: [
        [`${MOD}↵`, 'Make a shot from the selected words (or the line at the cursor)'],
        [`⇧${MOD}↵`, 'Shot without script text after the cursor'],
        ['Tab / ⇧Tab', 'Empty line: Character → Scene heading → Transition → Action'],
        ['Tab', 'After a name or dialogue: parenthetical; on action text: capitals'],
        ['↵ ↵', 'Enter twice: what you type next is outside the shot above'],
        [
          'Esc, then Tab',
          `Leave the script editor (or ${MOD === '⌘' ? '⇧⌥M' : 'Ctrl+M'}: Tab moves focus)`,
        ],
        ['Alt+↑ / Alt+↓', 'Move the focused shot card (its script text moves too)'],
      ],
    },
    {
      title: 'Canvas (with the frame focused)',
      keys: [
        ['Click / ⇧-click', 'Select a layer / add or remove it from the selection'],
        ['Drag on empty space', 'Select everything the box touches'],
        [`${MOD}A / Esc`, 'Select all / clear the selection'],
        ['Drag · Alt-drag', 'Move · move a copy'],
        [
          `Hold ${MOD === '⌘' ? '⌘' : 'Ctrl'} while dragging`,
          'Move without snapping (Alt too, once the drag started)',
        ],
        ['← → ↑ ↓ (⇧ ×10)', 'Nudge by 1 px (10 px)'],
        ['Delete / Backspace', 'Delete the selection'],
        [`${MOD}D`, 'Duplicate'],
        [`${MOD}G / ⇧${MOD}G`, 'Group / ungroup'],
        ['[ / ]', 'Send backward / bring forward'],
        ['Enter · double-click', 'Edit text · choose a picture for a slot'],
        [`${MOD}+ / ${MOD}− / ${MOD}0 / ⇧0`, 'Zoom in / out / to fit / 100 %'],
        ['Space-drag · scroll', 'Pan'],
        ['Alt+↑ / Alt+↓ (layer list)', 'Move a layer up / down'],
      ],
    },
    {
      title: 'Audio (in a shot’s Audio section or the Soundtrack)',
      keys: [
        ['↑ / ↓', 'Previous / next line'],
        ['P', 'Play the segment (or from the playhead)'],
        ['I / O', 'Mark in / out at the playhead'],
        ['A', 'Assign the segment to the line, then go to the next line'],
        ['Delete', 'Delete the selected cue'],
        ['Esc', 'Clear the marks / cue'],
      ],
    },
  ];
</script>

<Dialog bind:open={ui.shortcutsOpen} title="Keyboard shortcuts" id="shortcuts-dialog" width={560}>
  {#each groups as g (g.title)}
    <h3>{g.title}</h3>
    <dl>
      {#each g.keys as [k, what] (k)}
        <dt><kbd>{k}</kbd></dt>
        <dd>{what}</dd>
      {/each}
    </dl>
  {/each}
</Dialog>

<Dialog bind:open={ui.aboutOpen} title="About Storyboard Viewer" id="about-dialog" width={420}>
  <p><b>Storyboard Viewer</b> <span class="mono" id="app-version">{__APP_VERSION__}</span></p>
  <p class="muted">
    Offline-first storyboards in the open <code>.sbd</code> format: script, pictures and sound together.
    Agents edit them through MCP while you watch. MIT License.
  </p>
</Dialog>

<style>
  h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    margin: 12px 0 6px;
  }
  h3:first-child {
    margin-top: 0;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 0;
    font-size: 13px;
  }
  dt {
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--fg-2);
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 11.5px;
    padding: 0 4px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  p {
    margin: 0 0 8px;
  }
</style>
