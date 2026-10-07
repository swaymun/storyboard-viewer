// New versions reach open tabs: a static server (e2e/static.mjs --updates) serves build A, then
// "deploys" build B (a second real build with version `<version>-b`) on the same origin. With
// nothing unsaved the page switches by itself; with unsaved changes it shows "A new version is
// ready — Reload" and keeps the work.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const UPDATE_PORT = Number(process.env['E2E_PORT'] ?? 4471) + 3;
test.use({ baseURL: `http://localhost:${UPDATE_PORT}` });

const A = (
  JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
const B = `${A}-b`;

async function deploy(page: Page, build: 'a' | 'b') {
  const res = await page.request.post(`/__e2e/build?use=${build}`);
  expect(res.ok()).toBe(true);
}

/** The running app's version (null while the page reloads). */
const version = (page: Page) =>
  page
    .evaluate(() => (window as unknown as { __sbd?: { version: string } }).__sbd?.version ?? null)
    .catch(() => null);

/** Loads the app and waits until the service worker controls the page (served from cache). */
async function loadControlled(page: Page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => version(page)).toBe(A);
}

type Sbd = { __sbd: { app: { unsaved: boolean } } };

/** What the app does when the window gets focus again: look for a new version. */
const focus = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event('focus'))).catch(() => undefined);

test.beforeEach(async ({ page }) => {
  await deploy(page, 'a');
});
test.afterEach(async ({ page }) => {
  await deploy(page, 'a');
});

test('shows the version on the logo and in Help → About', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-logo')).toHaveAttribute('title', `Storyboard Viewer ${A}`);
  await page.locator('[data-example="cat-crimes.sbd"]').click();
  await page.locator('#help-menu').click();
  await page.getByRole('menuitem', { name: 'About Storyboard Viewer' }).click();
  await expect(page.locator('#app-version')).toHaveText(A);
});

test('nothing unsaved: a new deploy loads by itself', async ({ page }) => {
  await loadControlled(page);
  await deploy(page, 'b');
  // the check on focus finds the new worker; it takes over and the page reloads
  await expect
    .poll(
      async () => {
        await focus(page);
        return version(page);
      },
      { timeout: 20_000, intervals: [500, 1000, 2000, 3000] },
    )
    .toBe(B);
  await expect(page.locator('#app-logo')).toHaveAttribute('title', `Storyboard Viewer ${B}`);
  await expect(page.locator('#update-toast')).toHaveCount(0);
  // and it stays on B (served by the new worker)
  await page.reload();
  await expect.poll(() => version(page)).toBe(B);
});

test('unsaved changes: offers Reload instead and keeps the work', async ({ page }) => {
  await loadControlled(page);
  await page.locator('[data-example="cat-crimes.sbd"]').click();
  await page.goto('/#tab=story&view=board&shot=hook');
  const title = page.locator('#shot-title-input');
  await title.fill('Not saved yet');
  await title.press('Tab');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Sbd).__sbd.app.unsaved))
    .toBe(true);

  await deploy(page, 'b');
  const toast = page.locator('#update-toast');
  await expect
    .poll(
      async () => {
        await focus(page);
        return toast.isVisible();
      },
      { timeout: 20_000, intervals: [500, 1000, 2000, 3000] },
    )
    .toBe(true);
  await expect(toast).toContainText('A new version is ready');
  // no reload: still version A with the edit
  await page.waitForTimeout(1000);
  expect(await version(page)).toBe(A);
  await expect(title).toHaveValue('Not saved yet');
  await expect(page.locator('#update-reload')).toBeVisible();

  // the edit undone (nothing to save), Reload switches to the new version
  await page.locator('#tab-story').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Sbd).__sbd.app.unsaved))
    .toBe(false);
  await page.locator('#update-reload').click();
  await expect.poll(() => version(page), { timeout: 10_000 }).toBe(B);
});
