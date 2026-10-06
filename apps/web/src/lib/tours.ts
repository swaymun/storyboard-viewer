/**
 * Guided tours (Help → Guided tours). Each step points at an element by a stable
 * `data-tour="…"` attribute (not by CSS classes or text), so tours survive UI changes; a test
 * checks every target exists in its view (`e2e/tours.spec.ts`, `tours.test.ts`).
 *
 * A step without `target` is shown in the middle of the window. `prepare` gets the view ready
 * (switch tab, select a shot, open a panel) before the step looks for its target.
 */
import { activeVariant } from '@storyboard-viewer/format';
import { player } from './player.svelte';
import { app } from './state.svelte';
import { ui } from './ui.svelte';

export interface TourStep {
  /** Value of the `data-tour` attribute of the element to point at. */
  target?: string;
  title: string;
  body: string;
  prepare?: () => void | Promise<void>;
}

export interface Tour {
  id: TourId;
  title: string;
  /** One line for the menu / offer. */
  summary: string;
  steps: TourStep[];
}

export type TourId = 'getting-started' | 'script' | 'canvas' | 'assets' | 'audio' | 'agent';

const SETUP_URL = 'https://github.com/swaymun/storyboard-viewer#use-it-with-your-ai-agent';

const story =
  (view: 'script' | 'board' = 'script') =>
  () => {
    player.stageOpen = false;
    ui.soundtrackOpen = false;
    app.setTab('story');
    app.setStoryView(view);
  };

/** Opens the first shot (or the first one with sound / a canvas) so its card shows. */
function openShot(pred: (id: string) => boolean = () => true) {
  const s = app.shots.find((x) => pred(x.ref.id)) ?? app.shots[0];
  if (s) app.selectShot(s.ref.id, { scroll: true });
}

const hasSound = (id: string) => {
  const p = app.project;
  const ref = p?.ids.shots.find((s) => s.id === id);
  if (!p || !ref) return false;
  return p.timeline.cues.some((c) => {
    const t = c.target as { line?: string; shot?: string };
    return t.shot === id || (!!t.line && ref.lines.includes(t.line));
  });
};

function canvasShot() {
  player.stageOpen = false;
  ui.soundtrackOpen = false;
  app.setTab('canvas');
  const s = app.shots.find((x) => x.shot.variants?.some((v) => v.type === 'canvas'));
  if (!s) return;
  app.selectShot(s.ref.id);
  const shown = app.shownVariant(s.shot);
  if (shown?.type !== 'canvas') {
    const v =
      activeVariant(s.shot)?.type === 'canvas'
        ? activeVariant(s.shot)!
        : s.shot.variants!.find((x) => x.type === 'canvas')!;
    app.chooseVariant(s.shot, v.id);
  }
}

export const TOURS: readonly Tour[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'The main parts of the app in a minute',
    steps: [
      {
        title: 'Welcome to Storyboard Viewer',
        body: 'A storyboard here is a script, shots with pictures, and sound, all in one .sbd file or folder. This tour shows where things are. Use → or Next to continue, Esc to stop at any time.',
      },
      {
        target: 'menubar',
        title: 'Menus',
        body: 'Every command lives in these menus: File (save, export PDF and video), Edit (undo), View, Shot and Help. F10 jumps here from the keyboard.',
      },
      {
        target: 'tabs',
        title: 'Three views',
        body: 'Story is the script with its shots, Canvas arranges pictures and text in a shot, Assets holds every image, sound, video and font. Keys 1, 2, 3 switch.',
        prepare: story(),
      },
      {
        target: 'script',
        title: 'The script',
        body: 'Write or paste your script here (plain Fountain, like any screenwriting app). Tab changes what a line is: character, scene heading, action.',
        prepare: story(),
      },
      {
        target: 'shot-card',
        title: 'Shots',
        body: `Select some words and press ${navigatorMod()}Enter (or the Make shot button) to turn them into a shot. Each shot gets a card beside its words with its picture, sound and details.`,
        prepare: () => {
          story()();
          openShot();
        },
      },
      {
        target: 'player',
        title: 'Play it',
        body: 'Space plays the animatic: pictures and sound in time. Open the Animatic for a big picture, and the Soundtrack to see the audio tracks below it.',
        prepare: story(),
      },
      {
        target: 'save-status',
        title: 'Saving',
        body: 'This shows whether your changes are saved. Storyboards opened from a folder, from sbd serve or (in Chrome and Edge) from a .sbd file save by themselves.',
      },
      {
        target: 'view-menu',
        title: 'Themes',
        body: 'View → Appearance has eight light and dark themes.',
      },
      {
        target: 'help-menu',
        title: 'More tours',
        body: 'Help → Guided tours has a short tour for the script, the canvas, assets, audio and working with your AI agent. Help → Keyboard shortcuts lists every key.',
      },
    ],
  },
  {
    id: 'script',
    title: 'Script & shots',
    summary: 'Write the script and mark shots on it',
    steps: [
      {
        target: 'script',
        title: 'Write',
        body: 'Type like in any screenwriting app. Enter twice starts a new paragraph; Tab on an empty line cycles Character → Scene heading → Transition → Action.',
        prepare: story(),
      },
      {
        target: 'script',
        title: 'Make shots',
        body: `Select words (a whole line or just a few words) and press ${navigatorMod()}Enter. Shots never overlap: giving words to a shot takes them out of the other one. Right-click the script for more.`,
        prepare: story(),
      },
      {
        target: 'shot-card',
        title: 'The shot card',
        body: 'The open shot shows its picture, sound and details. Drag the little handles at the ends of its words to change what it covers; Alt+↑/↓ moves the shot.',
        prepare: () => {
          story()();
          openShot();
        },
      },
      {
        target: 'card-add',
        title: 'Add to a shot',
        body: '+ adds a title, a picture, a sound or details (camera, on-screen text, notes…) to the shot.',
        prepare: () => {
          story()();
          openShot();
        },
      },
      {
        target: 'board',
        title: 'Board view',
        body: 'View → Board shows the shots as cards in a grid, with a filter by tag. Drag cards to reorder.',
        prepare: story('board'),
      },
      {
        target: 'tabs',
        title: 'Back to the script',
        body: 'View → Script returns to the script. That is it for shots.',
        prepare: story('script'),
      },
    ],
  },
  {
    id: 'canvas',
    title: 'Canvas & layouts',
    summary: 'Arrange pictures and captions in a shot',
    steps: [
      {
        target: 'canvas-new',
        title: 'Versions of a shot',
        body: 'A shot can have several pictures (variants). + Canvas starts a layout of layers, from a ready-made layout or blank.',
        prepare: canvasShot,
      },
      {
        target: 'canvas-layout',
        title: 'Layouts',
        body: 'Layout arranges the canvas with named slots: split screen, picture-in-picture, caption band, talking head + B-roll… They follow the frame (9:16, 16:9). Drop a picture on a slot to fill it.',
        prepare: canvasShot,
      },
      {
        target: 'canvas-text',
        title: 'Text',
        body: 'Text adds captions and titles. Double-click text on the frame to type; pick a caption style, font, size and color on the right.',
        prepare: canvasShot,
      },
      {
        target: 'canvas-guides',
        title: 'Guides and snapping',
        body: 'Safe area shows the title-safe frame. On vertical videos, TikTok / Reels / Shorts show (roughly) where their buttons and captions cover the picture. Snap to guides pulls layers to edges and centers and says what it snapped to; hold ⌘/Ctrl to move freely.',
        prepare: canvasShot,
      },
      {
        target: 'canvas-stage',
        title: 'The frame',
        body: 'Click a layer to select it, Shift-click or drag a box for several, ⌘/Ctrl+A for all. Drag to move, Alt-drag to copy, handles to resize and rotate. Arrow keys nudge, Delete removes.',
        prepare: canvasShot,
      },
      {
        target: 'canvas-layers',
        title: 'Layers',
        body: 'Top of the list = front. Drag a row (or Alt+↑/↓) to reorder; hover a row to hide, lock or delete it. Select several to align, distribute or group them.',
        prepare: canvasShot,
      },
      {
        target: 'canvas-zoom',
        title: 'Zoom',
        body: `Zoom in and out (${navigatorMod()}+ / ${navigatorMod()}−), 100 % or Fit (${navigatorMod()}0). Hold Space and drag, or scroll, to pan.`,
        prepare: canvasShot,
      },
    ],
  },
  {
    id: 'assets',
    title: 'Assets',
    summary: 'Pictures, sounds, videos and fonts',
    steps: [
      {
        target: 'assets-import',
        title: 'Import',
        body: 'Import (or drop files anywhere here) adds pictures, sounds, videos and fonts to the storyboard.',
        prepare: () => app.setTab('assets'),
      },
      {
        target: 'assets-filters',
        title: 'Find things',
        body: 'Search, or filter by kind and category.',
        prepare: () => app.setTab('assets'),
      },
      {
        target: 'assets-grid',
        title: 'Use them',
        body: 'Click an asset for its details (name, category, tags, replace the file). Right-click → Use in shot puts a picture on the open shot.',
        prepare: () => app.setTab('assets'),
      },
    ],
  },
  {
    id: 'audio',
    title: 'Audio & soundtrack',
    summary: 'Dialogue, music and sound effects in time',
    steps: [
      {
        target: 'shot-audio',
        title: 'Sound on a shot',
        body: "The open shot's Audio section lists its lines with their sound. Pick a line, then P plays, I and O mark the start and end, A assigns that part of the recording to the line and moves on to the next.",
        prepare: () => {
          story()();
          openShot(hasSound);
        },
      },
      {
        target: 'animatic-toggle',
        title: 'Animatic',
        body: 'Animatic shows the pictures big while it plays.',
        prepare: story(),
      },
      {
        target: 'soundtrack',
        title: 'Soundtrack',
        body: 'With the animatic open, Soundtrack shows the tracks under the picture: every cue at its time, the playhead, and mute, solo and volume per track. Click a cue to open it in its shot. Music for the whole story is added here.',
        prepare: () => {
          app.setTab('story');
          player.stageOpen = true;
          ui.soundtrackOpen = true;
        },
      },
      {
        target: 'soundtrack-toggle',
        title: 'Show or hide it',
        body: 'This button (or View → Soundtrack) shows and hides the soundtrack.',
      },
    ],
  },
  {
    id: 'agent',
    title: 'Working with your AI agent',
    summary: 'Let Claude Code or Codex edit while you watch',
    steps: [
      {
        title: 'Your agent edits, you watch',
        body: 'Storyboard Viewer has an MCP server: AI agents such as Claude Code or Codex can write the script, make shots, lay out canvases with captions and add sound, while this page updates by itself.',
        prepare: story(),
      },
      {
        target: 'source',
        title: 'Where it comes from',
        body: 'This tag says where the storyboard comes from. “Live · sbd serve” means it is served by the sbd tool your agent uses, so every agent edit shows up here within a second; “.sbd file” or “Folder” means you opened it in the browser yourself.',
      },
      {
        target: 'save-status',
        title: 'Edits from both sides',
        body: 'You can keep working while the agent edits. Agent changes are merged with your unsaved ones; if both of you changed the same thing, yours is kept and a note offers the agent’s version.',
      },
      {
        target: 'menubar',
        title: 'Hand-offs',
        body: 'Shot → Copy shot ID (and Edit → Copy line ID) give your agent the exact thing to change. Ask it in plain words: “make shot 3 a split screen with a bold caption”.',
      },
      {
        title: 'Set it up',
        body: `The README has a copy-paste prompt that installs the tools and connects your agent: ${SETUP_URL}`,
      },
    ],
  },
];

function navigatorMod(): string {
  return typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl+';
}

export const tourById = (id: string) => TOURS.find((t) => t.id === id);
