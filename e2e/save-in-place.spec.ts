// Save writes back into the same .sbd file (0.5.0): a packed file served by `sbd serve`
// (re-packed atomically, .bak kept), and a file opened in the browser through a file handle
// (File System Access API; an origin-private file stands in for a picked one, since the native
// picker cannot be driven headless). Browsers without file handles download a copy instead.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CLI, EXAMPLE, ROOT } from './helpers.js';

const BASE = Number(process.env['E2E_PORT'] ?? 4471);
const HOSTED_PORT = BASE + 2;
const PACKED_PORT = BASE + 40;
const TMP = join(ROOT, 'e2e/.tmp/save-in-place');

let server: ChildProcess | null = null;
test.afterAll(() => {
  server?.kill('SIGTERM');
});

function pack(name: string): string {
  mkdirSync(TMP, { recursive: true });
  const file = join(TMP, name);
  rmSync(file, { force: true });
  rmSync(`${file}.bak`, { force: true });
  execFileSync(process.execPath, [CLI, 'pack', EXAMPLE, '-o', file]);
  return file;
}

/** The project inside a packed file (via `sbd unpack`). */
function unpacked(file: string) {
  const out = `${file}-unpacked`;
  rmSync(out, { recursive: true, force: true });
  execFileSync(process.execPath, [CLI, 'unpack', file, '-o', out]);
  const read = (rel: string) => JSON.parse(readFileSync(join(out, rel), 'utf8'));
  return { read, valid: execFileSync(process.execPath, [CLI, 'validate', file]).toString() };
}

async function retitle(page: Page, title: string) {
  await page.locator('#view-menu').click();
  await page.locator('[data-command="view-board"]').click();
  await page.locator('[data-shot-id="climb"] .select').click();
  await page.locator('#shot-title-input').fill(title);
  await page.locator('#shot-title-input').press('Tab');
}

test('sbd serve saves a packed .sbd in place (atomic re-pack, .bak of the original)', async ({
  page,
}) => {
  const file = pack('served.sbd');
  const original = readFileSync(file);
  server = spawn(process.execPath, [CLI, 'serve', file, '--port', String(PACKED_PORT)], {
    env: { ...process.env, SBD_CONFIG_DIR: join(TMP, 'config') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    server!.stdout!.on(
      'data',
      (d: Buffer) => d.toString().includes('Storyboard Viewer:') && resolve(),
    );
    server!.on('exit', (c) => reject(new Error(`sbd serve exited (${c})`)));
  });
  await page.goto(`http://localhost:${PACKED_PORT}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
  await expect(page.getByText('Live · sbd serve')).toBeVisible();
  await expect(page.locator('#save-status')).not.toHaveText('Read-only');
  await retitle(page, 'Saved into the packed file');
  await expect(page.locator('#save-status')).toHaveText('Saved');
  const { read, valid } = unpacked(file);
  expect(read('shots/climb.json').title).toBe('Saved into the packed file');
  expect(valid).toMatch(/0 errors/);
  expect(readFileSync(`${file}.bak`).equals(original)).toBe(true);
  expect(readFileSync(file).subarray(30, 38).toString()).toBe('mimetype');
  // the pictures still come out of the (new) zip
  await expect(page.locator('[data-shot-id="opening"] img').first()).toHaveJSProperty(
    'complete',
    true,
  );
});

test.describe('hosted copy', () => {
  test.use({ baseURL: `http://localhost:${HOSTED_PORT}` });

  test('a .sbd opened through a file handle saves (and autosaves) back into it', async ({
    page,
  }) => {
    const file = pack('handle.sbd');
    const b64 = readFileSync(file).toString('base64');
    // The picker is replaced by a file in the origin-private file system: same FileSystemFileHandle API.
    await page.addInitScript((data) => {
      (
        window as unknown as { showOpenFilePicker: () => Promise<FileSystemFileHandle[]> }
      ).showOpenFilePicker = async () => {
        const root = await navigator.storage.getDirectory();
        const h = await root.getFileHandle('story.sbd', { create: true });
        const w = await (
          h as FileSystemFileHandle & {
            createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
          }
        ).createWritable();
        await w.write(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))]));
        await w.close();
        return [h];
      };
    }, b64);
    await page.goto('/');
    await page.locator('#open-file').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
    const state = await page.evaluate(() => {
      const app = (
        window as unknown as {
          __sbd: { app: { canAutosave: boolean; saveMode: string; source: { inPlace: boolean } } };
        }
      ).__sbd.app;
      return { auto: app.canAutosave, mode: app.saveMode, inPlace: app.source.inPlace };
    });
    expect(state).toEqual({ auto: true, mode: 'file', inPlace: true });
    await retitle(page, 'Back into the same file');
    await expect(page.locator('#save-status')).toHaveText('Saved');
    const saved = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const f = await (await root.getFileHandle('story.sbd')).getFile();
      const bytes = new Uint8Array(await f.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    });
    const out = join(TMP, 'handle-after.sbd');
    writeFileSync(out, Buffer.from(saved, 'base64'));
    const { read } = unpacked(out);
    expect(read('shots/climb.json').title).toBe('Back into the same file');
    // media are still in the file (re-packed, STOREd)
    expect(existsSync(join(`${out}-unpacked`, 'media/dialogue.wav'))).toBe(true);
    // a second edit autosaves into it again (the original File is not read any more)
    await page.locator('#shot-title-input').fill('Twice');
    await page.locator('#shot-title-input').press('Tab');
    await expect(page.locator('#save-status')).toHaveText('Saved');
  });

  test('without file handles (Safari, Firefox) Save downloads a copy and says so', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w['showOpenFilePicker'];
      delete w['showSaveFilePicker'];
    });
    const file = pack('download.sbd');
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#open-file').click();
    await (await chooser).setFiles(file);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
    await retitle(page, 'Downloaded copy');
    await expect(page.locator('#save')).toHaveText('Download .sbd');
    const download = page.waitForEvent('download');
    await page.locator('#save').click();
    await download;
    await expect(page.getByText('cannot save into the file you opened')).toBeVisible();
  });
});
