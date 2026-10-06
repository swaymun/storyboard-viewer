// The Canvas tab (0.5.0): layouts and slots, text layers, multi-select, align / distribute,
// groups, delete + undo, snapping labels, zoom and numeric fields. Runs against the editing
// server (own copy of examples/minimal.sbd, reset before each test).
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { EDIT_STORY, EXAMPLE } from './helpers.js';

const EDIT_PORT = Number(process.env['E2E_PORT'] ?? 4471) + 1;
test.use({ baseURL: `http://localhost:${EDIT_PORT}` });

function walk(base: string, dir = base, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(base, abs, out);
    else out.push(relative(base, abs));
  }
  return out;
}
test.beforeEach(() => {
  for (const rel of walk(EDIT_STORY))
    if (!existsSync(join(EXAMPLE, rel))) rmSync(join(EDIT_STORY, rel));
  cpSync(EXAMPLE, EDIT_STORY, { recursive: true, force: true });
});

// oxlint-disable-next-line typescript/no-explicit-any
const disk = (rel: string): any => JSON.parse(readFileSync(join(EDIT_STORY, rel), 'utf8'));
// oxlint-disable-next-line typescript/no-explicit-any
const climbVariant = (id = 'layout'): any =>
  disk('shots/climb.json').variants.find((v: { id: string }) => v.id === id);
// oxlint-disable-next-line typescript/no-explicit-any
const layerOf = (id: string, variant = 'layout'): any =>
  climbVariant(variant).layers.find((l: { id: string }) => l.id === id);
const status = (page: Page) => page.locator('#save-status');

async function open(page: Page) {
  await page.goto('/#tab=canvas&shot=climb');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
  await expect(page.locator('.stage canvas').first()).toBeVisible();
}

/** Screen position of a canvas (frame) point. */
async function at(page: Page, x: number, y: number) {
  const stage = page.locator('.stage');
  const d = await stage.evaluate((e) => ({ ...(e as HTMLElement).dataset }));
  const b = (await stage.boundingBox())!;
  return {
    x: b.x + Number(d['originX']) + x * Number(d['zoom']),
    y: b.y + Number(d['originY']) + y * Number(d['zoom']),
  };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

test('layout picker: a new canvas with slots, a picture dropped into a slot', async ({ page }) => {
  await open(page);
  await page.locator('#new-canvas').click();
  const picker = page.locator('#layout-picker');
  await expect(picker).toBeVisible();
  // 16:9 frames get the 16:9 layouts (and Blank)
  await expect(picker.locator('[data-layout]')).toHaveCount(5);
  await picker.locator('[data-layout="two-up"]').click();
  await expect(page.locator('#layer-list [data-layer-row]')).toHaveCount(2);
  await expect(status(page)).toHaveText('Saved');
  const v = disk('shots/climb.json').variants.at(-1);
  expect(v.type).toBe('canvas');
  expect(v.layers.map((l: { kind: string; name: string }) => [l.kind, l.name])).toEqual([
    ['slot', 'Left'],
    ['slot', 'Right'],
  ]);
  expect(disk('manifest.json').format_version).toBe('0.3.0');

  // drop a picture on the right slot: it fills (covers) the slot
  const target = await at(page, 960, 360);
  const host = (await page.locator('.stage-host').boundingBox())!;
  await page.locator('.lib-item[data-asset-id="lamp"]').dragTo(page.locator('.stage-host'), {
    targetPosition: { x: target.x - host.x, y: target.y - host.y },
  });
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Fill slot');
  await expect(status(page)).toHaveText('Saved');
  const right = disk('shots/climb.json')
    .variants.at(-1)
    .layers.find((l: { id: string }) => l.id === 'right');
  expect(right).toMatchObject({ asset: 'lamp', x: 640, y: 0, width: 640, height: 720 });
  expect(right.slot).toMatchObject({ x: 640, width: 640, name: 'Right' });
  expect(right.crop.width).toBeLessThan(640); // cover: the sides of the 16:9 picture are cropped
  expect(right.kind).toBeUndefined();

  // Fit in slot / Fill slot toggle
  await page.locator('button[data-layer-id="right"]').click();
  await page.getByRole('radio', { name: 'Fit in slot' }).click();
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Fit in slot');
  await expect
    .poll(() => disk('shots/climb.json').variants.at(-1).layers.at(-1).slot.fit)
    .toBe('contain');
});

test('apply a layout to an existing canvas maps its pictures into the slots', async ({ page }) => {
  await open(page);
  await page.locator('#apply-layout').click();
  await page.locator('#layout-picker [data-layout="two-up"]').click();
  await expect(status(page)).toHaveText('Saved');
  expect(layerOf('bg').slot.name).toBe('Left');
  expect(layerOf('maya').slot.name).toBe('Right');
  expect(layerOf('box').slot).toBeUndefined();
});

test('text layer: add, type inline, caption style, font and color', async ({ page }) => {
  await open(page);
  await page.locator('#add-text').click();
  const editor = page.locator('#text-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Lights out');
  await page.keyboard.press('Meta+Enter');
  await expect(editor).toHaveCount(0);
  await expect(status(page)).toHaveText('Saved');
  const text = () =>
    climbVariant().layers.find((l: { kind?: string }) => l.kind === 'text') as Record<
      string,
      unknown
    >;
  await expect.poll(() => text()?.['text']).toBe('Lights out');
  await page.locator('[data-caption-style="title"]').click();
  await expect.poll(() => text()['style']).toBe('title');
  expect(text()['uppercase']).toBe(true);
  await page.locator('[data-font="Courier Prime"]').click();
  await expect.poll(() => text()['font']).toBe('Courier Prime');
  await page.locator('[data-text-color="#ffe14d"]').click();
  await expect.poll(() => text()['color']).toBe('#ffe14d');
  await page.locator('#text-box').click();
  await expect.poll(() => (text()['box'] as { color: string } | undefined)?.color).toBeTruthy();
  // the card in the Story tab draws it too (canvas per text layer)
  await page.getByRole('tab', { name: 'Story' }).click();
  await page.locator('#view-menu').click();
  await page.locator('[data-command="view-board"]').click();
  await expect(
    page.locator(`[data-shot-id="climb"] .layer[data-layer-id="${text()['id']}"] canvas`),
  ).toHaveAttribute('data-fonts', 'loaded');
});

test('multi-select (Shift-click, marquee), align, distribute, group and ungroup', async ({
  page,
}) => {
  await open(page);
  // Shift-click in the layer list
  await page.locator('button[data-layer-id="maya"]').click();
  await page.locator('button[data-layer-id="box"]').click({ modifiers: ['Shift'] });
  await expect(page.locator('#layer-list li.selected')).toHaveCount(2);
  await page.locator('[data-align="top"]').click();
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Align');
  await expect(status(page)).toHaveText('Saved');
  // the rotated matchbox aligns by its bounding box: both tops line up on the higher one
  expect(layerOf('maya').y).toBe(150);
  await page.locator('.stage').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#layer-list li.selected')).toHaveCount(0);

  // Cmd/Ctrl-click on the frame adds and removes a layer
  const m = layerOf('maya');
  const maya = await at(page, m.x + 150, m.y + 250);
  await page.mouse.click(maya.x, maya.y);
  await expect(page.locator('#layer-list li.selected')).toHaveCount(1);
  const bx = layerOf('box');
  const box = await at(page, bx.x + 60, bx.y + 45);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.click(box.x, box.y);
  await expect(page.locator('#layer-list li.selected')).toHaveCount(2);
  await page.mouse.click(box.x, box.y);
  await page.keyboard.up('ControlOrMeta');
  await expect(page.locator('#layer-list li.selected')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // marquee from outside the frame over everything
  await drag(page, await at(page, -20, -20), await at(page, 1270, 710));
  await expect(page.locator('#layer-list li.selected')).toHaveCount(3);
  await page.getByRole('radio', { name: 'To frame' }).click();
  await page.locator('[data-distribute="x"]').click();
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Distribute');
  await page.locator('#group-layers').click();
  await expect(status(page)).toHaveText('Saved');
  const g = layerOf('bg').group;
  expect(g).toBeTruthy();
  expect(layerOf('maya').group).toBe(g);
  await expect(page.locator('#layer-list [data-group-id]')).toHaveCount(1);
  // clicking one member selects the whole group
  await page.locator('.stage').focus();
  await page.keyboard.press('Escape');
  await page.locator('button[data-layer-id="box"]').click();
  await expect(page.locator('#layer-list li.selected')).toHaveCount(3);
  await page.locator('#ungroup-layers').click();
  await expect(status(page)).toHaveText('Saved');
  expect(layerOf('bg').group).toBeUndefined();
  // ⌘A selects all, Esc clears
  await page.locator('.stage').focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('#layer-list li.selected')).toHaveCount(3);
});

test('delete with × and with the Delete key, then undo', async ({ page }) => {
  await open(page);
  await page.locator('[data-layer-row="box"]').hover();
  await page.locator('[data-delete-layer="box"]').click();
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Delete layer');
  await expect(status(page)).toHaveText('Saved');
  expect(climbVariant().layers).toHaveLength(2);
  await page.locator('button[data-layer-id="maya"]').click();
  await page.locator('button[data-layer-id="maya"]').press('Delete');
  await expect(page.locator('#layer-list [data-layer-row]')).toHaveCount(1);
  await page.locator('#undo').click();
  await page.locator('#undo').click();
  await expect(page.locator('#layer-list [data-layer-row]')).toHaveCount(3);
  await expect(status(page)).toHaveText('Saved');
  expect(climbVariant().layers.map((l: { id: string }) => l.id)).toEqual(['bg', 'maya', 'box']);
  // duplicate (⌘D) from the stage
  await page.locator('button[data-layer-id="box"]').click();
  await page.locator('.stage').focus();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('#layer-list [data-layer-row]')).toHaveCount(4);
});

test('dragging shows what it snaps to; Cmd/Ctrl moves freely; Alt-drag copies', async ({
  page,
}) => {
  await open(page);
  // the matchbox (120×80 at 860,430): drag its center onto the frame's vertical center line
  const from = await at(page, 900, 470);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await at(page, 640 - 20 + 3, 470); // 3 px off the center → snaps
  await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await expect(page.locator('#snap-status')).toContainText('Frame center');
  await page.mouse.up();
  await expect(page.locator('#snap-status')).toHaveText('');
  await expect(status(page)).toHaveText('Saved');
  const box = layerOf('box');
  // rotated by −12°: its bounding box is centered on x = 640
  expect(Math.abs(box.x - 860 + (900 - 620 - 3))).toBeLessThan(40);

  // holding Cmd/Ctrl: no snapping
  const b = layerOf('box');
  const c1 = await at(page, b.x + 40, b.y + 40);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.move(c1.x, c1.y);
  await page.mouse.down();
  await page.mouse.move(c1.x + 5, c1.y + 1, { steps: 3 });
  await page.mouse.move(c1.x + 9, c1.y + 1, { steps: 3 });
  await expect(page.locator('#snap-status')).toHaveText('');
  await page.mouse.up();
  await page.keyboard.up('ControlOrMeta');
  await expect(status(page)).toHaveText('Saved');
  await expect.poll(() => layerOf('box').x).not.toBe(b.x);

  // Alt-drag leaves the original and moves a copy
  const p1 = await at(page, 520 + 150, 150 + 250);
  await page.keyboard.down('Alt');
  await drag(page, p1, { x: p1.x + 60, y: p1.y });
  await page.keyboard.up('Alt');
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Duplicate layers');
  await expect(status(page)).toHaveText('Saved');
  expect(layerOf('maya').x).toBe(520);
  expect(climbVariant().layers).toHaveLength(4);
});

test('zoom buttons and keys; numeric position, size and rotation', async ({ page }) => {
  await open(page);
  const zoom = () => page.locator('.stage').getAttribute('data-zoom').then(Number);
  const fit = await zoom();
  await page.locator('#zoom-in').click();
  expect(await zoom()).toBeCloseTo(fit * 1.25, 3);
  await expect(page.locator('#zoom-fit')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#zoom-100').click();
  expect(await zoom()).toBe(1);
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await page.locator('.stage').focus();
  await page.keyboard.press('ControlOrMeta+0');
  expect(await zoom()).toBeCloseTo(fit, 5);
  await expect(page.locator('#zoom-fit')).toHaveAttribute('aria-pressed', 'true');

  // numbers: layers keep frame coordinates whatever the zoom
  await page.locator('button[data-layer-id="maya"]').click();
  const w = page.getByLabel('W', { exact: true });
  await expect(w).toHaveValue('352'); // 220 × 1.6
  await w.fill('440');
  await w.press('Enter');
  await expect(status(page)).toHaveText('Saved');
  expect(layerOf('maya').scale_x).toBe(2);
  expect(layerOf('maya').scale_y).toBe(2); // proportions kept
  const x = page.getByLabel('X', { exact: true });
  await x.fill('100');
  await x.press('Enter');
  const rot = page.getByLabel('Rotation °');
  await rot.fill('15');
  await rot.press('Enter');
  await expect(status(page)).toHaveText('Saved');
  await expect.poll(() => layerOf('maya').x).toBe(100);
  await expect.poll(() => layerOf('maya').rotation).toBe(15);
});

test.describe('vertical frame (hosted example)', () => {
  test.use({ baseURL: `http://localhost:${EDIT_PORT + 1}` });

  test('platform safe zones toggle, and dragging snaps to their edges', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-example="cat-crimes.sbd"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Rating My Cat's 3 A.M. Crimes",
    );
    await page.goto('/#tab=canvas&shot=twist');
    await expect(page.locator('button[data-layer-id="twist-caption"]')).toBeVisible();
    const tiktok = page.locator('[data-platform="tiktok"]');
    await expect(tiktok).toHaveAttribute('aria-pressed', 'false');
    await tiktok.click();
    await expect(tiktok).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('sbd:canvas-platforms')))
      .toBe('["tiktok"]');
    // the caption (top at y = 0.64 × 1920) dragged up to just below TikTok's top bar (7 %)
    const app = await page.evaluate(() => {
      const p = (
        window as unknown as {
          __sbd: {
            app: {
              project: {
                shots: Record<
                  string,
                  { variants: Array<{ layers: Array<{ id: string; x: number; y: number }> }> }
                >;
              };
            };
          };
        }
      ).__sbd.app.project;
      const l = p.shots['twist']!.variants.at(-1)!.layers.find((x) => x.id === 'twist-caption')!;
      return { x: l.x, y: l.y };
    });
    const from = await at(page, app.x + 450, app.y + 40);
    const to = await at(page, app.x + 450 + 30, 1920 * 0.07 + 2 + 40);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(page.locator('#snap-status')).toContainText('TikTok top bar');
    await page.mouse.up();
    // the other platforms only show on vertical frames
    await expect(page.locator('[data-platform]')).toHaveCount(3);
  });
});
