/**
 * Shot commands shared by the shot cards (Script and Board views), their context menus and the
 * Shot menu of the menu bar, so every place offers the same actions with the same labels.
 */
import {
  addShot,
  addVariant,
  duplicateShot,
  mergeShots,
  moveShotWithLines,
  removeShot,
  splitShot,
} from '@storyboard-viewer/format';
import { tick } from 'svelte';
import { sep, type MenuItem } from './menu';
import { player } from './player.svelte';
import { app } from './state.svelte';
import { copyText, ui } from './ui.svelte';

const label = (id: string) => {
  const e = app.shots.find((s) => s.ref.id === id);
  return e ? `Shot ${e.index + 1}${e.shot.title ? `: ${e.shot.title}` : ''}` : id;
};

/** Which control of a shot's card has focus (so it can get focus back after a re-render). */
function focusedControl(id: string): string | null {
  const el = document.activeElement as HTMLElement | null;
  const card = el?.closest<HTMLElement>('[data-shot-id]');
  if (!el || !card || card.dataset['shotId'] !== id) return null;
  for (const sel of ['.grip', '.select', '[data-annotation-title]'])
    if (el.matches(sel)) return sel;
  return el.matches('article') ? '' : '.select';
}

/**
 * Gives focus back to a shot card's control after the card moved in the DOM (moving a focused
 * node drops focus to <body>). Tries over a few frames because the Script view lays cards out
 * in passes.
 */
export async function refocusShot(id: string, sel: string): Promise<void> {
  await tick();
  const q = CSS.escape(id);
  for (let i = 0; i < 4; i++) {
    const el = document.querySelector<HTMLElement>(
      sel
        ? `[data-annotation="${q}"] ${sel}, article.shot[data-shot-id="${q}"] ${sel}`
        : `[data-annotation="${q}"], article.shot[data-shot-id="${q}"]`,
    );
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    await new Promise((r) => requestAnimationFrame(r));
  }
}

/** Moves a shot (and its script lines) by `delta` positions, keeping keyboard focus on it. */
export function moveShotBy(id: string, delta: number): string | null {
  const from = app.shots.findIndex((s) => s.ref.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= app.shots.length) return null;
  const sel = focusedControl(id);
  if (!app.edit('Move shot', (p) => moveShotWithLines(p, id, { index: to }))) return null;
  if (sel !== null) void refocusShot(id, sel);
  return `Moved ${label(id)} to position ${to + 1} of ${app.shots.length}`;
}

export function deleteShot(id: string): void {
  const name = label(id);
  if (app.edit('Delete shot', (p) => removeShot(p, id)))
    app.toast(`Deleted ${name}`, {
      kind: 'info',
      action: { label: 'Undo', run: () => app.undo() },
    });
}

/** Asks for an image/video asset and adds it to the shot as the new active variant. */
export async function addImageToShot(id: string): Promise<void> {
  const assetId = await ui.pickAsset(['image', 'video'], 'Add a picture to this shot');
  if (!assetId) return;
  const asset = app.assets.get(assetId);
  let vid = '';
  if (
    app.edit('Add variant', (p) => {
      const r = addVariant(
        p,
        id,
        { type: 'image', asset: assetId, name: asset?.name ?? 'Image' },
        { activate: true },
      );
      vid = r.id;
      return r;
    })
  ) {
    const shot = app.project?.shots[id];
    if (shot) app.chooseVariant(shot, vid);
  }
}

export function insertShotAfter(id: string): void {
  let nid = '';
  if (
    app.edit('Add shot', (p) => {
      const r = addShot(p, { after: id });
      nid = r.id;
      return r;
    })
  )
    app.selectShot(nid, { scroll: true });
}

export async function copyShotId(id: string): Promise<void> {
  if (await copyText(id)) app.toast(`Copied shot ID ${id}`, { kind: 'info' });
}

/** The shot commands as menu items (card ⋯ menu, context menus, Shot menu). */
export function shotMenuItems(
  id: string,
  opts: { onMoved?: (msg: string) => void } = {},
): MenuItem[] {
  const index = app.shots.findIndex((s) => s.ref.id === id);
  const ref = app.shots[index]?.ref;
  const count = app.shots.length;
  const edit = app.canEdit;
  const sel = app.selectedLine;
  const splitLine = sel && ref && ref.lines.indexOf(sel) > 0 ? sel : null;
  const move = (d: number) => {
    const msg = moveShotBy(id, d);
    if (msg) opts.onMoved?.(msg);
  };
  const items: MenuItem[] = [
    {
      label: 'Play shot',
      icon: 'play',
      command: 'play-shot',
      onSelect: () => player.playShot(id),
    },
  ];
  if (edit)
    items.push(
      sep(),
      {
        label: 'Add picture…',
        icon: 'image',
        command: 'add-picture',
        onSelect: () => void addImageToShot(id),
      },
      {
        label: 'Insert shot after',
        icon: 'plus',
        command: 'insert-shot-after',
        onSelect: () => insertShotAfter(id),
      },
      {
        label: 'Duplicate',
        icon: 'copy',
        command: 'duplicate-shot',
        onSelect: () => app.edit('Duplicate shot', (p) => duplicateShot(p, id)),
      },
      {
        label: splitLine ? 'Split at selected line' : 'Split (select a line first)',
        icon: 'scissors',
        command: 'split-shot',
        disabled: !splitLine,
        onSelect: () => app.edit('Split shot', (p) => splitShot(p, id, splitLine!)),
      },
      {
        label: 'Merge with next shot',
        icon: 'merge',
        command: 'merge-shot',
        disabled: index >= count - 1,
        onSelect: () => {
          const next = app.shots[index + 1]?.ref.id;
          if (next) app.edit('Merge shots', (p) => mergeShots(p, id, next));
        },
      },
      sep(),
      {
        label: 'Move up',
        icon: 'up',
        shortcut: 'Alt+↑',
        command: 'move-shot-up',
        disabled: index <= 0,
        onSelect: () => move(-1),
      },
      {
        label: 'Move down',
        icon: 'down',
        shortcut: 'Alt+↓',
        command: 'move-shot-down',
        disabled: index >= count - 1,
        onSelect: () => move(1),
      },
    );
  items.push(sep(), {
    label: 'Copy shot ID',
    icon: 'copy',
    command: 'copy-shot-id',
    onSelect: () => void copyShotId(id),
  });
  if (app.tab === 'story')
    items.push(
      app.storyView === 'script'
        ? {
            label: 'Show in Board',
            icon: 'board',
            onSelect: () => {
              app.setStoryView('board');
              app.selectShot(id, { scroll: true });
            },
          }
        : {
            label: 'Show in Script',
            icon: 'script',
            onSelect: () => {
              app.selectShot(id);
              app.setStoryView('script');
            },
          },
    );
  if (edit)
    items.push(sep(), {
      label: 'Delete shot',
      icon: 'trash',
      danger: true,
      command: 'delete-shot',
      onSelect: () => deleteShot(id),
    });
  return items;
}
