// M3: exports (Fountain, PDF print view, animatic video, `sbd export-pdf`) and New storyboard.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import { CLI, STORY } from './helpers.js';

const run = promisify(execFile);

async function open(page: Page, query = '') {
  await page.goto(`/${query}`);
  await expect(page.locator('#project-title')).toHaveText("The Keeper's Light");
}

async function fileMenu(page: Page, item: RegExp) {
  await page.click('#file-menu');
  await page.getByRole('menuitem', { name: item }).click();
}

test('exports the script as Fountain', async ({ page }) => {
  await open(page);
  const download = page.waitForEvent('download');
  await fileMenu(page, /Export script \(Fountain\)/);
  const d = await download;
  expect(d.suggestedFilename()).toBe('story.fountain');
  const text = readFileSync(await d.path(), 'utf8');
  expect(text).toBe(readFileSync(join(STORY, 'script.fountain'), 'utf8'));
});

test('print view lays out storyboard sheets', async ({ page }) => {
  await open(page);
  await fileMenu(page, /Export PDF/);
  await page.locator('#pdf-per-page [data-value="3"]').click();
  await page.click('#pdf-preview');
  await expect(page).toHaveURL(/print=1.*per=3/);
  const sheets = page.locator('.sheets');
  await expect(sheets).toHaveAttribute('data-print-ready', 'true');
  // Title page + 2 pages of 3 shots.
  await expect(sheets).toHaveAttribute('data-pages', '3');
  await expect(page.locator('.cell[data-shot-id]')).toHaveCount(4);
  await expect(page.locator('.cell[data-shot-id="climb"] .line.scene_heading')).toHaveText(
    'INT. LANTERN ROOM - NIGHT',
  );
  await expect(page.locator('#print-now')).toBeEnabled();
  // Rows layout from the URL, without lines.
  await page.goto('/?print=1&layout=rows&lines=0&title=0');
  await expect(page.locator('.sheets')).toHaveAttribute('data-print-ready', 'true');
  await expect(page.locator('.row[data-shot-id]')).toHaveCount(4);
  await expect(page.locator('.row .script')).toHaveCount(0);
  await page.click('#print-close');
  await expect(page.locator('#tab-story')).toBeVisible();
  expect(page.url()).not.toContain('print=');
});

test('exports an animatic video with sound', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await fileMenu(page, /Export animatic video/);
  await page.locator('#video-height [data-value="480"]').click();
  await page.locator('#video-fps [data-value="12"]').click();
  const download = page.waitForEvent('download', { timeout: 100_000 });
  await page.click('#video-export');
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^story-animatic\.(mp4|webm)$/);
  expect(statSync(await d.path()).size).toBeGreaterThan(50_000);
  await expect(page.locator('#video-done')).toContainText(/27\.4 s/);
  await expect(page.locator('#video-done')).toContainText(/\+/); // video + audio codecs
});

test('creates a new storyboard from a preset', async ({ page }) => {
  await page.goto('/?source=local');
  await page.click('#new-storyboard');
  await page.fill('#new-title', 'Snack Launch');
  await page.locator('[data-preset="vertical"]').click();
  await page.click('#new-create');
  await expect(page.locator('#project-title')).toHaveText('Snack Launch');
  const manifest = await page.evaluate(
    () =>
      (window as unknown as { __sbd: { app: { project: { manifest: unknown } } } }).__sbd.app
        .project.manifest,
  );
  expect(manifest).toMatchObject({ preset: 'vertical', aspect_ratio: '9:16', fps: 30 });
  // New storyboards open in the Script view: add a shot without script text (no script yet)
  await page.click('#add-lineless-shot');
  await expect(page.locator('article[data-shot-id]')).toHaveCount(1);
  await expect(page.locator('.cm-content [data-lineless]')).toHaveCount(1);
});

test('sbd export-pdf writes a PDF', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'sbd-pdf-'));
  try {
    const out = join(dir, 'board.pdf');
    const { stdout } = await run(
      process.execPath,
      [CLI, 'export-pdf', STORY, '-o', out, '--per', '9'],
      {
        timeout: 110_000,
      },
    );
    expect(stdout).toMatch(/Wrote .*board\.pdf \(2 pages/);
    const pdf = readFileSync(out);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
