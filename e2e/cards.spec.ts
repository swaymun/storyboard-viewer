// 0.4.1: compact shot cards (details, tags and versions folded into a summary row), easier span
// handles (large hit area, keyboard), the playback mark in the script, and the resizable guide.
// Runs against the editing server (own copy of examples/minimal.sbd, reset before each test).
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { EDIT_STORY, EXAMPLE, selectInScript } from './helpers.js';

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
function resetStory() {
  for (const rel of walk(EDIT_STORY))
    if (!existsSync(join(EXAMPLE, rel))) rmSync(join(EDIT_STORY, rel));
  cpSync(EXAMPLE, EDIT_STORY, { recursive: true, force: true });
}
// oxlint-disable-next-line typescript/no-explicit-any
const disk = (rel: string): any => JSON.parse(readFileSync(join(EDIT_STORY, rel), 'utf8'));
const lineId = (prefix: string): string =>
  disk('ids.json').lines.find((l: { text: string }) => l.text.startsWith(prefix)).id;
const shotRef = (id: string) => disk('ids.json').shots.find((s: { id: string }) => s.id === id);
const status = (page: Page) => page.locator('#save-status');
const WAVES = 'Waves crash against black rocks. At the top of the tower, the lamp is dark.';

async function open(page: Page, hash = '#tab=story') {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
  if (!hash.includes('view=board')) await expect(page.locator('.cm-content')).toBeVisible();
}

test.beforeEach(() => resetStory());

test('populated cards start compact: one summary row expands details, tags, versions', async ({
  page,
}) => {
  await open(page, '#tab=story&shot=opening');
  const card = page.locator('article[data-annotation="opening"]');
  const summary = card.locator('[data-shot-summary="opening"]');
  // picture and title stay; details and the variant strip are folded away
  await expect(card.locator('[aria-roledescription="carousel"] img').first()).toBeVisible();
  await expect(summary).toHaveText('5 details · 2 versions');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('[data-field]')).toHaveCount(0);
  await expect(card.getByRole('button', { name: /^Variant 2/ })).toHaveCount(0);
  const compact = (await card.boundingBox())!.height;
  // Enter expands
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('[data-field]')).toHaveCount(5);
  await expect(card.getByRole('button', { name: /^Variant 2/ })).toBeVisible();
  expect((await card.boundingBox())!.height).toBeGreaterThan(compact + 100);
  // remembered for the session: other cards and a reload open expanded
  await page.reload();
  await expect(page.locator('article[data-annotation="opening"] [data-field]')).toHaveCount(5);
  await page.locator('article[data-annotation="climb"] .select').click();
  await expect(page.locator('article[data-annotation="climb"] [data-field]').first()).toBeVisible();
  // collapse again
  await page.locator('[data-shot-summary="climb"]').click();
  await expect(page.locator('article[data-annotation="climb"] [data-field]')).toHaveCount(0);
});

test('Board inspector: details and tags fold into the summary row too', async ({ page }) => {
  await open(page, '#tab=story&view=board&shot=opening');
  const inspector = page.locator('[data-inspector="opening"]');
  const summary = inspector.locator('[data-shot-summary="opening"]');
  await expect(summary).toHaveText('5 details · 2 versions');
  await expect(inspector.locator('[data-field]')).toHaveCount(0);
  await expect(inspector.locator('#shot-title-input')).toBeVisible();
  await summary.click();
  await expect(inspector.locator('[data-field]')).toHaveCount(5);
  await expect(inspector.getByRole('heading', { name: 'Tags' })).toBeVisible();
});

test('span handles: large hit area, resize cursor, keyboard with a visible focus ring', async ({
  page,
}) => {
  await open(page);
  const waves = lineId('Waves crash');
  await selectInScript(page, { line: waves, words: 'black rocks' });
  await page.locator('#make-shot').click();
  await expect(status(page)).toHaveText('Saved');
  const id = disk('ids.json').shots.find(
    (s: { id: string; start?: { line: string } }) => s.start?.line === waves,
  ).id;
  const end = page.locator(`.sb-handle.end[data-handle-shot="${id}"]`);
  await expect(end).toBeVisible();
  const hit = await end.evaluate((h) => {
    const after = getComputedStyle(h, '::after');
    const r = h.getBoundingClientRect();
    // a point 6 px right of the bar (outside the words) still grabs the handle
    const at = document.elementFromPoint(r.x + r.width / 2 + 6, r.y + r.height / 2);
    return {
      w: parseFloat(after.width),
      h: parseFloat(after.height),
      cursor: after.cursor,
      grabs: at === h,
    };
  });
  expect(hit.w).toBeGreaterThanOrEqual(16);
  expect(hit.h).toBeGreaterThanOrEqual(24);
  expect(hit.cursor).toBe('ew-resize');
  expect(hit.grabs).toBe(true);

  // keyboard: Esc, Tab reaches the handles; → moves the end by a word
  await page.locator(`.sb-text[data-shot-id="${id}"]`).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  const start = page.locator(`.sb-handle.start[data-handle-shot="${id}"]`);
  await expect(start).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(end).toBeFocused();
  const ring = await end.evaluate((h) => getComputedStyle(h, '::after').outlineStyle);
  expect(ring).toBe('solid');
  await page.keyboard.press('ArrowRight');
  await expect(status(page)).toHaveText('Saved');
  // "black rocks" → "black rocks. At"
  const at = WAVES.indexOf('At the') + 2;
  expect(shotRef(id).end).toEqual({ line: waves, offset: at });
  await expect(page.locator(`.sb-handle.end[data-handle-shot="${id}"]`)).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => shotRef(id).end.offset).toBe(at - 1);
  // Esc goes back to the text
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('playback: the playing words are marked strongly with a sweeping marker', async ({ page }) => {
  await open(page);
  await expect(page.locator('.sb-now, .sb-playing')).toHaveCount(0); // at rest: nothing
  await page.locator('#play-toggle').click();
  const now = page.locator('.sb-text.sb-now').first();
  await expect(now).toBeVisible();
  await expect(page.locator('.cm-line.sb-playing')).toHaveCount(1);
  const style = await now.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, image: cs.backgroundImage };
  });
  expect(style.name).toBe('sb-sweep');
  expect(style.image).toContain('linear-gradient');
  await page.locator('#play-toggle').click(); // pause: the marker holds
  await expect(page.locator('.sb-text.sb-now.sb-paused').first()).toBeVisible();
  // reduced motion: a still, full underline
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await page
    .locator('.sb-text.sb-now')
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, size: cs.backgroundSize };
    });
  expect(still).toEqual({ name: 'none', size: '100% 3px' });
});

test('Fountain guide: narrower by default, resizable by dragging or keys, remembered', async ({
  page,
}) => {
  await open(page);
  await page.locator('#help-menu').click();
  await page.locator('#help-menu-list [data-command="toggle-guide"]').click();
  const guide = page.locator('#fountain-guide');
  await expect(guide).toBeVisible();
  const w0 = (await guide.boundingBox())!.width;
  expect(w0).toBeLessThan(260);
  const edge = page.locator('#guide-resize');
  const e = (await edge.boundingBox())!;
  await page.mouse.move(e.x + e.width / 2, e.y + 200);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 + 100, e.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await guide.boundingBox())!.width))
    .toBe(Math.round(w0 + 100));
  await edge.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(edge).toHaveAttribute('aria-valuenow', String(Math.round(w0 + 100 - 16)));
  await page.reload();
  await expect(page.locator('#fountain-guide')).toBeVisible();
  expect(Math.round((await page.locator('#fountain-guide').boundingBox())!.width)).toBe(
    Math.round(w0 + 84),
  );
  // the script keeps the rest of the width
  const page0 = (await page.locator('.page').boundingBox())!;
  expect(page0.x).toBeGreaterThan(w0 + 84);
  await page.evaluate(() => {
    localStorage.removeItem('sbd:guide-width');
    localStorage.removeItem('sbd:guide-open');
  });
});
