// Editing in the app against `sbd serve` (second server, own copy of the example). Each test
// starts from a fresh copy of examples/minimal.sbd.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CLI, EDIT_STORY, EXAMPLE, ROOT, mcpCall } from './helpers.js';

const EDIT_PORT = Number(process.env['E2E_PORT'] ?? 4471) + 1;
test.use({ baseURL: `http://localhost:${EDIT_PORT}` });

/** Package-relative paths of all files under `base`. */
function walk(base: string, dir = base, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(base, abs, out);
    else out.push(relative(base, abs));
  }
  return out;
}

/** Restores the served copy to the example (deleting files the previous test added). */
function resetStory() {
  for (const rel of walk(EDIT_STORY))
    if (!existsSync(join(EXAMPLE, rel))) rmSync(join(EDIT_STORY, rel));
  cpSync(EXAMPLE, EDIT_STORY, { recursive: true, force: true });
}

// oxlint-disable-next-line typescript/no-explicit-any
const disk = (rel: string): any => JSON.parse(readFileSync(join(EDIT_STORY, rel), 'utf8'));
const diskText = (rel: string) => readFileSync(join(EDIT_STORY, rel), 'utf8');
const lineIdByText = (prefix: string): string =>
  disk('ids.json').lines.find((l: { text: string }) => l.text.startsWith(prefix)).id;

async function open(page: Page, hash = '') {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
}

async function autosaveOff(page: Page) {
  await page.locator('#file-menu').click();
  const item = page.getByRole('menuitemcheckbox', { name: 'Save automatically' });
  await expect(item).toHaveAttribute('aria-checked', 'true');
  await item.click();
}

const status = (page: Page) => page.locator('#save-status');

test.beforeEach(() => resetStory());

test('Board: reorder shots with the keyboard and by drag and drop', async ({ page }) => {
  await open(page, '#tab=story&view=board');
  const order = () =>
    page
      .locator('article[data-shot-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-shot-id')));
  await page.locator('[data-shot-id="match"] .grip').focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(order).toEqual(['opening', 'match', 'climb', 'lamp']);
  await expect(page.locator('[data-shot-id="match"] .grip')).toBeFocused();
  await expect(status(page)).toHaveText('Saved');
  expect(disk('ids.json').shots.map((s: { id: string }) => s.id)).toEqual([
    'opening',
    'match',
    'climb',
    'lamp',
  ]);
  // the shot's lines moved with it: script order follows shot order
  const script = diskText('script.fountain');
  expect(script.indexOf('Okay, Grandpa')).toBeLessThan(script.indexOf('INT. LANTERN ROOM'));

  // HTML5 drag and drop with real mouse moves (drop on the top half of the first card)
  await page.locator('main').evaluate((m) => (m.scrollTop = 0));
  await page.locator('article[data-shot-id="match"]').hover();
  const grip = (await page.locator('[data-shot-id="match"] .grip').boundingBox())!;
  const first = (await page.locator('article[data-shot-id="opening"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 30, grip.y - 40, { steps: 5 });
  await page.mouse.move(first.x + 200, first.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect.poll(order).toEqual(['match', 'opening', 'climb', 'lamp']);
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Move shot');
  await expect(status(page)).toHaveText('Saved');
  await expect
    .poll(() => disk('ids.json').shots.map((s: { id: string }) => s.id))
    .toEqual(['match', 'opening', 'climb', 'lamp']);
});

test('undo and redo with labels, buttons and shortcuts', async ({ page }) => {
  await open(page, '#tab=story&view=board&shot=climb');
  const title = page.locator('#shot-title-input');
  await title.fill('Renamed');
  await title.press('Tab');
  await expect(page.getByRole('heading', { name: 'Shot 2: Renamed' })).toBeVisible();
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Rename shot');

  await page.locator('#tab-story').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('heading', { name: 'Shot 2: Maya reaches the top' })).toBeVisible();
  await expect(page.locator('#redo')).toHaveAttribute('aria-label', 'Redo: Rename shot');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByRole('heading', { name: 'Shot 2: Renamed' })).toBeVisible();

  // structural edits undo too
  await page.locator('article[data-shot-id="lamp"]').hover();
  await page.getByRole('button', { name: /Actions for Shot 4/ }).click();
  await page.getByRole('menuitem', { name: 'Delete shot' }).click();
  await expect(page.locator('article[data-shot-id]')).toHaveCount(3);
  await page.locator('#undo').click();
  await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
  await expect(status(page)).toHaveText('Saved');
  expect(disk('shots/climb.json').title).toBe('Renamed');
  expect(existsSync(join(EDIT_STORY, 'shots/lamp.json'))).toBe(true);
});

test('split and merge shots from the shot menu', async ({ page }) => {
  await open(page, '#tab=story&view=board');
  const id = lineIdByText('Okay, Grandpa');
  await page.locator(`[data-line-id="${id}"]`).click();
  await page.getByRole('button', { name: /Actions for Shot 3/ }).click();
  await page.getByRole('menuitem', { name: 'Split at selected line' }).click();
  await expect(page.locator('article[data-shot-id]')).toHaveCount(5);
  const newShot = page.locator('article[data-shot-id]').nth(3);
  await expect(newShot.locator('[data-line-id]').first()).toHaveText('Okay, Grandpa. Show me how.');
  await page.getByRole('button', { name: /Actions for Shot 3/ }).click();
  await page.getByRole('menuitem', { name: 'Merge with next shot' }).click();
  await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
  await expect(status(page)).toHaveText('Saved');
  expect(disk('ids.json').shots.find((s: { id: string }) => s.id === 'match').lines).toContain(id);
});

test('canvas: drag, transform values and nudging persist', async ({ page }) => {
  await open(page, '#tab=canvas&shot=climb');
  await page.locator('button[data-layer-id="maya"]').click();
  await expect(page.locator('.props')).toBeVisible();
  const climb = () => disk('shots/climb.json');
  const maya = () =>
    climb()
      .variants.find((v: { type: string }) => v.type === 'canvas')
      .layers.find((l: { id: string }) => l.id === 'maya');
  const before = maya();
  const asset = disk('assets.json').assets.find((a: { id: string }) => a.id === 'maya');
  // canvas → screen: the stage shows the frame with a 36 px margin
  const stage = page.locator('.stage .konvajs-content');
  const box = (await stage.boundingBox())!;
  const scale = (box.width - 72) / 1280;
  const cx = box.x + 36 + (before.x + (asset.width * before.scale_x) / 2) * scale;
  const cy = box.y + 36 + (before.y + (asset.height * before.scale_y) / 2) * scale;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 20, { steps: 6 });
  await page.mouse.move(cx - 120, cy + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Move layer');
  await expect(status(page)).toHaveText('Saved');
  const moved = maya();
  expect(moved.x).toBeLessThan(before.x - 100);
  expect(moved.y).toBeGreaterThan(before.y + 30);

  // numeric transform + keyboard nudge
  const rotation = page.getByLabel('Rotation °');
  await rotation.fill('12');
  await rotation.press('Enter');
  await page.locator('.stage').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(status(page)).toHaveText('Saved');
  await expect.poll(() => maya().rotation).toBe(12);
  await expect.poll(() => maya().x).toBe(moved.x + 10);

  // filter slider writes CSS-semantics filters; the DOM card renders the same
  await page.locator('details.group summary', { hasText: 'Filters' }).click();
  await page.locator('[data-filter="grayscale"] input').fill('1');
  await expect.poll(() => maya().filters).toEqual([{ type: 'grayscale', value: 1 }]);
  await page.getByRole('tab', { name: 'Story' }).click();
  await expect(page.locator('[data-shot-id="climb"] .layer[data-layer-id="maya"]')).toHaveCSS(
    'filter',
    'grayscale(1)',
  );
});

test('import an asset and edit its details', async ({ page }) => {
  const src = join(ROOT, 'e2e/.tmp/Prop Lantern.png');
  cpSync(join(EXAMPLE, 'media/matchbox.png'), src);
  await open(page, '#tab=assets');
  await expect(page.locator('button[data-asset-id]')).toHaveCount(11);
  await page.locator('#asset-file-input').setInputFiles(src);
  await expect(page.locator('button[data-asset-id]')).toHaveCount(12);
  await expect(page.locator('#asset-name-input')).toHaveValue('Prop Lantern');
  // category: free text with suggestions (pick the existing "Prop")
  const category = page.locator('#asset-category-input');
  await category.fill('pro');
  await page.getByRole('option', { name: 'Prop', exact: true }).click();
  await expect(category).toHaveValue('Prop');
  await expect(status(page)).toHaveText('Saved');
  const asset = disk('assets.json').assets.find((a: { name: string }) => a.name === 'Prop Lantern');
  expect(asset).toMatchObject({ kind: 'image', src: 'media/prop-lantern.png', category: 'prop' });
  expect(asset.width).toBeGreaterThan(0);
  expect(existsSync(join(EDIT_STORY, 'media/prop-lantern.png'))).toBe(true);

  // delete a used asset: warns first
  await page.locator('button[data-asset-id="maya"]').click();
  await page.locator('#delete-asset').click();
  await expect(page.getByRole('alert')).toContainText('Used in 1 place');
  await page.locator('#confirm-delete-asset').click();
  await expect(page.locator('button[data-asset-id="maya"]')).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(page.locator('button[data-asset-id="maya"]')).toHaveCount(1);
});

// The Timeline tab's "assign a trimmed segment" test moved to audio.spec.ts (shot Audio section).

test('agent edits arriving while the app has unsaved changes are merged', async ({ page }) => {
  await open(page, '#tab=story&view=board&shot=climb');
  await autosaveOff(page);
  const title = page.locator('#shot-title-input');
  await title.fill('Local title');
  await title.press('Tab');
  await expect(status(page)).toHaveText('Unsaved changes');

  const res = await mcpCall('update_shot', { shot_id: 'lamp', title: 'Agent title' }, EDIT_STORY);
  expect(res.isError).toBeFalsy();
  await expect(page.locator('[data-toast="agent"]')).toContainText('Updated by agent');
  await expect(page.getByRole('heading', { name: 'Shot 4: Agent title' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shot 2: Local title' })).toBeVisible();
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.locator('#tab-story').focus();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(status(page)).toHaveText('Saved');
  expect(disk('shots/climb.json').title).toBe('Local title');
  expect(disk('shots/lamp.json').title).toBe('Agent title');

  // Same field changed on both sides: yours is kept, the agent's version is one click away.
  await title.fill('Mine again');
  await title.press('Tab');
  await mcpCall('update_shot', { shot_id: 'climb', title: 'Agent wins' }, EDIT_STORY);
  const toast = page.locator('[data-toast="agent"]');
  await expect(toast).toContainText('conflicted');
  await expect(page.getByRole('heading', { name: 'Shot 2: Mine again' })).toBeVisible();
  await toast.getByRole('button', { name: 'Use agent’s version' }).click();
  await expect(page.getByRole('heading', { name: 'Shot 2: Agent wins' })).toBeVisible();
  await expect(status(page)).not.toHaveText('Unsaved changes');
});

test('packed .sbd opened in the browser: edit, then export a new .sbd', async ({ page }) => {
  const packed = join(ROOT, 'e2e/.tmp/edit-packed.sbd');
  rmSync(packed, { force: true });
  execFileSync(process.execPath, [CLI, 'pack', EXAMPLE, '-o', packed]);
  await page.goto('/?source=local');
  await page.locator('#file-input').setInputFiles(packed);
  await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
  const id = lineIdByText('She strikes a match');
  // type in the script editor: "She strikes a match. The flame flickers." → "… It flares."
  const line = page.locator(`.cm-line[data-line-id="${id}"]`);
  await line.click();
  await page.keyboard.press('End');
  for (let i = 0; i < 'The flame flickers.'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('It flares.');
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.locator('#file-menu').click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export .sbd file' }).click();
  const file = join(ROOT, 'e2e/.tmp/exported.sbd');
  await (await download).saveAs(file);
  const out = join(ROOT, 'e2e/.tmp/exported-unpacked');
  rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, [CLI, 'unpack', file, '-o', out]);
  expect(readFileSync(join(out, 'script.fountain'), 'utf8')).toContain(
    'She strikes a match. It flares.',
  );
  const ids = JSON.parse(readFileSync(join(out, 'ids.json'), 'utf8'));
  expect(ids.lines.find((l: { id: string }) => l.id === id).text).toBe(
    'She strikes a match. It flares.',
  );
  // media survived the re-pack
  expect(readFileSync(join(out, 'media/dialogue.wav'))).toEqual(
    readFileSync(join(EXAMPLE, 'media/dialogue.wav')),
  );
});

test('folder opened with the File System Access API saves only changed files', async ({ page }) => {
  // OPFS directory handles implement the same API as a folder picked with showDirectoryPicker.
  const files: Record<string, string> = {};
  for (const rel of walk(EXAMPLE)) files[rel] = readFileSync(join(EXAMPLE, rel)).toString('base64');
  await page.goto('/?source=local#tab=story&view=board');
  await page.evaluate(async (tree) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('story.sbd', { recursive: true }).catch(() => {});
    const dir = await root.getDirectoryHandle('story.sbd', { create: true });
    for (const [path, b64] of Object.entries(tree)) {
      const segs = path.split('/');
      let d = dir;
      for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
      const fh = await d.getFileHandle(segs.at(-1)!, { create: true });
      const w = await fh.createWritable();
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      await w.close();
    }
    const sbd = (
      window as unknown as {
        __sbd: {
          app: { open(s: unknown): Promise<void> };
          sources: { folderSource(h: unknown): unknown };
        };
      }
    ).__sbd;
    await sbd.app.open(sbd.sources.folderSource(dir));
  }, files);
  await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
  await expect(page.getByText('Folder', { exact: true })).toBeVisible();
  const mtimes = () =>
    page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('story.sbd');
      const read = async (p: string) => {
        const segs = p.split('/');
        let d = dir;
        for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s);
        const f = await (await d.getFileHandle(segs.at(-1)!)).getFile();
        return { modified: f.lastModified, text: await f.text() };
      };
      return { climb: await read('shots/climb.json'), lamp: await read('shots/lamp.json') };
    });
  const before = await mtimes();
  await page.locator('[data-shot-id="climb"] .select').click();
  await page.locator('#shot-title-input').fill('Saved into the folder');
  await page.locator('#shot-title-input').press('Tab');
  await expect(status(page)).toHaveText('Saved');
  const after = await mtimes();
  expect(JSON.parse(after.climb.text).title).toBe('Saved into the folder');
  expect(after.lamp.modified).toBe(before.lamp.modified);
  // the folder poll sees our own write and does not clobber or flag anything
  await page.waitForTimeout(2500);
  await expect(page.getByRole('heading', { name: 'Shot 2: Saved into the folder' })).toBeVisible();
  await expect(page.locator('[data-toast="agent"]')).toHaveCount(0);
});
