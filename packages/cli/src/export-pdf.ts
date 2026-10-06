/**
 * `sbd export-pdf`: serves the storyboard on a temporary localhost port, opens the app's print
 * view (`?print=1&…`) in a headless Chromium-family browser and saves it with `page.pdf()`.
 *
 * Uses `playwright-core` (JavaScript only, no bundled browser) to drive a browser that is already
 * installed: Google Chrome, Microsoft Edge, or Playwright's own Chromium if it was downloaded
 * (`npx playwright install chromium`). `--browser <path>` or `SBD_BROWSER` picks one explicitly.
 * The PDF therefore looks exactly like File → Export PDF in the app.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.js';
import { ProjectStore } from './store.js';

export interface PdfOptions {
  layout: 'grid' | 'rows';
  perPage: number;
  paper: 'letter' | 'a4';
  lines: boolean;
  fields: boolean;
  notes: boolean;
  titlePage: boolean;
  /** Browser executable (Chrome, Edge, Chromium, Brave…). */
  browser?: string;
  timeoutMs?: number;
}

export function printQuery(o: PdfOptions): string {
  const q = new URLSearchParams({ print: '1', layout: o.layout, paper: o.paper, chrome: '0' });
  if (o.layout === 'grid') q.set('per', String(o.perPage));
  if (!o.lines) q.set('lines', '0');
  if (!o.fields) q.set('fields', '0');
  if (!o.notes) q.set('notes', '0');
  if (!o.titlePage) q.set('title', '0');
  return q.toString();
}

type Chromium = typeof import('playwright-core').chromium;
type Browser = Awaited<ReturnType<Chromium['launch']>>;

const NO_BROWSER = [
  'No Chromium-based browser found for the PDF export.',
  'Install Google Chrome (or Microsoft Edge), or run "npx playwright install chromium",',
  'or point to a browser with --browser /path/to/chrome (or the SBD_BROWSER variable).',
  'Alternative: open the storyboard with "sbd serve" and use File → Export PDF in the app.',
].join('\n');

/** Launches the first browser that works: explicit path, Chrome, Edge, Playwright's Chromium. */
export async function launchBrowser(explicit?: string): Promise<Browser> {
  let chromium: Chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error('playwright-core is not installed (run pnpm install in the repo).');
  }
  const path = explicit ?? process.env['SBD_BROWSER'];
  if (path) {
    if (!existsSync(path)) throw new Error(`Browser not found: ${path}`);
    return chromium.launch({ executablePath: path, headless: true });
  }
  const attempts: Array<Parameters<Chromium['launch']>[0]> = [
    { channel: 'chrome' },
    { channel: 'msedge' },
    {}, // Playwright's downloaded Chromium / headless shell
  ];
  for (const opts of attempts) {
    try {
      return await chromium.launch({ ...opts, headless: true });
    } catch {
      /* try the next one */
    }
  }
  throw new Error(NO_BROWSER);
}

export async function exportPdf(
  projectPath: string,
  out: string,
  opts: PdfOptions,
  log: (msg: string) => void = () => {},
): Promise<{ pages: number; bytes: number }> {
  const store = ProjectStore.open(projectPath);
  const srv = await startServer(store, { port: 0, watch: false, register: false });
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser(opts.browser);
    log(`Rendering with ${browser.browserType().name()} ${browser.version()}`);
    const page = await browser.newPage();
    const url = `${srv.url}?${printQuery(opts)}`;
    await page.goto(url, { waitUntil: 'load' });
    const timeout = opts.timeoutMs ?? 90_000;
    const sheets = page.locator('.sheets[data-print-ready="true"]');
    await sheets.waitFor({ state: 'attached', timeout });
    const pages = Number(await sheets.getAttribute('data-pages'));
    await page.emulateMedia({ media: 'print' });
    await mkdir(dirname(resolve(out)), { recursive: true });
    const pdf = await page.pdf({
      path: out,
      preferCSSPageSize: true,
      printBackground: true,
      outline: true,
      tagged: true,
    });
    return { pages, bytes: pdf.length };
  } finally {
    await browser?.close().catch(() => {});
    await srv.close();
  }
}
