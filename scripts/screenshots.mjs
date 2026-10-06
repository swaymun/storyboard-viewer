#!/usr/bin/env node
// Captures the README screenshots into docs/images/ (WebP, light + dark where useful):
// story-light/story-dark (Script view, System theme → Paper/Darkroom), board, canvas, audio
// (a shot's Audio section and the Soundtrack panel), assets, pdf, new-storyboard.
//
//   pnpm build && pnpm screenshots                       # uses examples/minimal.sbd
//   pnpm screenshots -- --story examples/film.sbd        # any unpacked storyboard
//   pnpm screenshots -- --shot climb --out docs/images   # shot to select, output folder
//
// Serves a temporary copy of the storyboard with the built CLI (`sbd serve`) and drives
// Chromium with playwright-core (an installed Chrome is used when Playwright's own Chromium is
// missing). The browser itself converts PNG captures to WebP, so no image tools are needed.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// `pnpm screenshots -- --story x` passes a literal "--" through; drop it.
const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const { values } = parseArgs({
  args: argv,
  options: {
    story: { type: 'string', default: join(ROOT, 'examples/minimal.sbd') },
    out: { type: 'string', default: join(ROOT, 'docs/images') },
    shot: { type: 'string' },
    port: { type: 'string', default: '4499' },
    quality: { type: 'string', default: '0.82' },
  },
});

const OUT = resolve(values.out);
const PORT = Number(values.port);
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 1.5;

// Temporary copy so screenshots never change the real storyboard.
const work = mkdtempSync(join(tmpdir(), 'sbd-shots-'));
const story = join(work, basename(resolve(values.story)));
cpSync(resolve(values.story), story, { recursive: true });

const server = spawn(
  process.execPath,
  [join(ROOT, 'packages/cli/dist/cli.js'), 'serve', story, '--port', String(PORT)],
  // its own recent list: temporary copies stay off the user's (~/.config/storyboard-viewer)
  {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, SBD_CONFIG_DIR: join(work, 'config') },
  },
);
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => d.toString().includes('Storyboard Viewer:') && res(null));
  server.on('exit', (c) => rej(new Error(`sbd serve exited (${c}). Did you run pnpm build?`)));
});

async function launch() {
  for (const opts of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try {
      return await chromium.launch(opts);
    } catch {
      /* next */
    }
  }
  throw new Error('No Chromium found: run "npx playwright install chromium" or install Chrome.');
}

const browser = await launch();
mkdirSync(OUT, { recursive: true });
const written = [];

async function toWebp(page, png, name) {
  const b64 = png.toString('base64');
  const webp = await page.evaluate(
    async ({ b64, q }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', q));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000)
        s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { b64, q: Number(values.quality) },
  );
  const file = join(OUT, `${name}.webp`);
  writeFileSync(file, Buffer.from(webp, 'base64'));
  written.push(`${name}.webp (${Math.round(Buffer.from(webp, 'base64').length / 1024)} KB)`);
}

async function session(colorScheme) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme,
  });
  // a returning user: no first-run tour offer or canvas hint; TikTok's safe zones on vertical
  // canvases (ignored on other frames)
  await context.addInitScript(() => {
    try {
      localStorage.setItem('sbd:tour-offered', '1');
      localStorage.setItem('sbd:canvas-hint-done', 'true');
      localStorage.setItem('sbd:canvas-platforms', '["tiktok"]');
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();
  page.on('crash', () => console.error('page crashed'));
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  return { context, page };
}

let loads = 0;
async function openApp(page, hash = '#tab=story') {
  // A query that changes every time forces a real reload (hash-only changes would not).
  await page.goto(`${BASE}/?v=${++loads}${hash}`);
  await page.locator('#project-title').waitFor({ timeout: 20_000 });
  // Wait for visible images (lazy ones off-screen never load, hence the time limit).
  await page.evaluate(() =>
    Promise.race([
      Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
      new Promise((r) => setTimeout(r, 3000)),
    ]),
  );
}

async function shoot(page, name, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 600);
  const png = await page.screenshot(opts.clip ? { clip: opts.clip } : {});
  await toWebp(page, png, name);
}

const firstShot = async (page) =>
  values.shot ?? (await page.evaluate(() => window.__sbd.app.project.ids.shots[0]?.id ?? ''));

try {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await session(scheme);
    // Theme "System": Paper when light, Darkroom when dark.
    await openApp(page);
    const shot = await firstShot(page);
    // Script view with the shot's annotation card open beside its lines
    await openApp(page, `#tab=story&view=script&shot=${shot}`);
    await page.locator('.cm-content').waitFor();
    await page.locator('main').evaluate((m) => (m.scrollTop = 0));
    await shoot(page, `story-${scheme}`, { wait: 1200 });
    if (scheme === 'light') {
      await openApp(page, `#tab=story&view=board&shot=${shot}`);
      await page.locator('main').evaluate((m) => (m.scrollTop = 0));
      await shoot(page, 'board');
      await openApp(page, `#tab=canvas&shot=${shot}`);
      // Prefer a shot with a canvas variant for the canvas screenshot (--shot first, if it has one).
      const canvasShot = await page.evaluate((wanted) => {
        const p = window.__sbd.app.project;
        const hasCanvas = (id) => p.shots[id]?.variants?.some((v) => v.type === 'canvas');
        if (wanted && hasCanvas(wanted)) return wanted;
        return p.ids.shots.find((s) => hasCanvas(s.id))?.id;
      }, values.shot ?? null);
      if (canvasShot) await openApp(page, `#tab=canvas&shot=${canvasShot}`);
      // select the top layer (often a caption) to show the selection tools
      const rows = page.locator('#layer-list button.name[data-layer-id]');
      if (await rows.count()) await rows.first().click();
      await shoot(page, 'canvas', { wait: 1200 });
      // Audio (the Timeline tab before 0.3.0): a shot with line cues, its Audio section open on
      // a cue (lines with their cues, waveform trim editor, cue details).
      const audioShot = await page.evaluate((wanted) => {
        const p = window.__sbd.app.project;
        const lineCues = new Set(p.timeline.cues.map((c) => c.target.line).filter(Boolean));
        const has = (id) =>
          p.ids.shots.find((s) => s.id === id)?.lines.some((l) => lineCues.has(l));
        if (wanted && has(wanted)) return wanted;
        return p.ids.shots.find((s) => s.lines.some((l) => lineCues.has(l)))?.id ?? wanted;
      }, values.shot ?? null);
      await openApp(page, `#tab=story&view=script&shot=${audioShot}`);
      await page.locator('.cm-content').waitFor();
      const card = page.locator(`article[data-annotation="${audioShot}"]`);
      await card.locator('[data-audio-section] .sec-head').click();
      await card.locator('[data-audio-lines] .badge').first().click();
      await card
        .locator('[data-audio-section]')
        .evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shoot(page, 'audio', { wait: 1200 });
      await openApp(page, '#tab=assets');
      await shoot(page, 'assets');
      await page.goto(`${BASE}/?print=1&layout=grid&per=6&title=0`);
      await page.locator('.sheets[data-print-ready="true"]').waitFor();
      await shoot(page, 'pdf');
      await page.goto(`${BASE}/?source=local`);
      await page.click('#new-storyboard');
      await page.locator('[data-preset="vertical"]').click();
      await shoot(page, 'new-storyboard');
    }
    await context.close();
  }
  console.log(`Wrote to ${OUT}:\n  ${written.join('\n  ')}`);
} finally {
  await browser.close();
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
