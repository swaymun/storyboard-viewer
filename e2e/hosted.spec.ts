// The app as a plain static site (the hosted copy): no `sbd serve`, so no /api at all.
import { expect, test, type Page } from '@playwright/test';

const HOSTED_PORT = Number(process.env['E2E_PORT'] ?? 4471) + 2;
test.use({ baseURL: `http://localhost:${HOSTED_PORT}` });

/** Console errors, failed requests and any request to /api during the test. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) problems.push(`request: ${r.url()}`);
  });
  page.on('requestfailed', (r) => problems.push(`failed: ${r.url()}`));
  return problems;
}

test.describe('hosted (static, no sbd serve)', () => {
  test('start screen offers open, new and the bundled examples, without /api requests', async ({
    page,
  }) => {
    const problems = watch(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Open a storyboard' })).toBeVisible();
    await expect(page.locator('#open-file')).toBeVisible();
    await expect(page.locator('#new-storyboard')).toBeVisible();
    await expect(page.locator('#open-folder')).toBeVisible(); // Chromium
    await expect(page.locator('[data-example]')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'How to set it up' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
  });

  test('opens a bundled example, editable in the browser', async ({ page }) => {
    const problems = watch(page);
    await page.goto('/');
    await page.locator('[data-example="cat-crimes.sbd"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      "Rating My Cat's 3 A.M. Crimes",
    );
    await page.goto('/#tab=story&view=board');
    await expect(page.locator('article[data-shot-id]').first()).toBeVisible();
    const state = await page.evaluate(() => {
      const app = (window as unknown as { __sbd: { app: { canEdit: boolean; saveMode: string } } })
        .__sbd.app;
      return { canEdit: app.canEdit, saveMode: app.saveMode };
    });
    expect(state.canEdit).toBe(true);
    expect(['file', 'download']).toContain(state.saveMode);
    // pictures come out of the packed file
    await expect(page.locator('article[data-shot-id] img').first()).toHaveAttribute(
      'src',
      /^blob:/,
    );
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
  });

  test('works offline once loaded (service worker)', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload(); // now controlled by the service worker
    await page.locator('[data-example="pips-kite.sbd"]').click(); // cached at runtime
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Pip's Kite");
    await context.setOffline(true);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Open a storyboard' })).toBeVisible();
    await page.locator('[data-example="pips-kite.sbd"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Pip's Kite");
    await context.setOffline(false);
  });

  test('a single-image portrait variant shows whole, inside its frame (Canvas, card, animatic)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('[data-example="cat-crimes.sbd"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // shot 1 ("hook"): its "Deadpan" variant is one 9:16 image
    await page.goto('/#tab=canvas&shot=hook');
    await page.locator('[data-variant-id="deadpan"]').click();

    /** The picture's box lies inside the frame's, and the frame inside `container`. */
    async function fits(frame: string, container: string, what: string) {
      const f = page.locator(frame).first();
      const img = f.locator('img');
      await expect(img, what).toBeVisible();
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(720);
      const fb = (await f.boundingBox())!;
      const ib = (await img.boundingBox())!;
      const cb = (await page.locator(container).first().boundingBox())!;
      const inside = (a: typeof fb, b: typeof fb) =>
        a.x >= b.x - 1 &&
        a.y >= b.y - 1 &&
        a.x + a.width <= b.x + b.width + 1 &&
        a.y + a.height <= b.y + b.height + 1;
      expect(inside(ib, fb), `${what}: picture inside the frame`).toBe(true);
      expect(inside(fb, cb), `${what}: frame inside ${container}`).toBe(true);
      // 9:16, not stretched or cut
      expect(fb.width / fb.height, what).toBeCloseTo(9 / 16, 2);
      expect(ib.width / ib.height, what).toBeCloseTo(9 / 16, 2);
      return fb;
    }

    const canvas = await fits('.single .frame', '.stage-host', 'Canvas');
    // at Fit: as large as the stage allows (not a thumbnail)
    const stage = (await page.locator('.stage-host').boundingBox())!;
    expect(canvas.height).toBeGreaterThan(stage.height - 40);

    await page.getByRole('tab', { name: 'Story' }).click();
    await page.goto('/#tab=story&view=board&shot=hook');
    await fits('article[data-shot-id="hook"] .frame', 'article[data-shot-id="hook"]', 'Story card');

    await page.locator('#animatic-toggle').click();
    // play shot 1 and stop on it
    await page.locator('#play-toggle').click();
    await expect(page.locator('#animatic img')).toBeVisible();
    await page.locator('#play-toggle').click();
    await fits('#animatic .frame .frame', '#animatic', 'Animatic');
  });
});
