// Guided tours on the hosted copy (static server, bundled examples): the first-run offer, every
// tour started from Help → Guided tours with each step finding its target, keyboard control.
import { expect, test, type Page } from '@playwright/test';

const HOSTED_PORT = Number(process.env['E2E_PORT'] ?? 4471) + 2;
test.use({ baseURL: `http://localhost:${HOSTED_PORT}` });

const TOURS = [
  'Getting started',
  'Script & shots',
  'Canvas & layouts',
  'Assets',
  'Audio & soundtrack',
  'Working with your AI agent',
];

async function openExample(page: Page) {
  await page.goto('/');
  await page.locator('[data-example="cat-crimes.sbd"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Rating My Cat's 3 A.M. Crimes");
}

async function startFromHelp(page: Page, name: string) {
  await page.locator('#help-menu').click();
  await page.locator('[data-command="tours"]').click();
  await page.getByRole('menuitem', { name }).click();
  await expect(page.locator('#tour')).toBeVisible();
}

/** Walks a tour to its end; every step with a target must find it. */
async function walk(page: Page, name: string) {
  const pop = page.locator('#tour');
  const total = Number(
    /of (\d+)/.exec((await pop.locator('.count').textContent()) ?? '')?.[1] ?? 0,
  );
  expect(total).toBeGreaterThan(2);
  for (let i = 0; i < total; i++) {
    await expect(pop).toHaveAttribute('data-tour-step', String(i));
    await expect(pop).toHaveAttribute('data-ready', 'true', { timeout: 5000 });
    const found = await pop.getAttribute('data-target-found');
    const target = await pop.getAttribute('data-tour-target');
    expect(`${name} step ${i + 1} (${target}): ${found}`).not.toContain(': false');
    await expect(pop).toBeFocused();
    if (i % 2) await page.keyboard.press('ArrowRight');
    else await pop.locator('#tour-next').click();
  }
  await expect(pop).toHaveCount(0);
}

test('the first-run offer appears once, opens an example and starts Getting started', async ({
  browser,
}) => {
  // a brand-new browser (no remembered offer)
  const context = await browser.newContext({
    baseURL: `http://localhost:${HOSTED_PORT}`,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto('/');
  const offer = page.locator('#tour-offer');
  await expect(offer).toBeVisible();
  await page.locator('#tour-offer-start').click();
  // nothing was open: the bundled example opens first
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Rating My Cat's 3 A.M. Crimes");
  await expect(page.locator('#tour')).toHaveAttribute('data-tour-id', 'getting-started');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tour')).toHaveCount(0);
  // never offered again
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(offer).toHaveCount(0);
  await context.close();
});

test('the first-run offer sits clear of the playback controls and the header', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: `http://localhost:${HOSTED_PORT}`,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('[data-example="cat-crimes.sbd"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const offer = page.locator('#tour-offer');
  await expect(offer).toBeVisible();
  const box = (await offer.boundingBox())!;
  const header = (await page.locator('header.top').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
  for (const tab of ['Story', 'Canvas']) {
    await page.getByRole('tab', { name: tab }).click();
    for (const sel of ['#play-toggle', 'footer[data-tour="player"]']) {
      const el = page.locator(sel).first();
      await expect(el).toBeVisible();
      const b = (await el.boundingBox())!;
      const overlap =
        box.x < b.x + b.width &&
        b.x < box.x + box.width &&
        box.y < b.y + b.height &&
        b.y < box.y + box.height;
      expect(overlap, `${tab}: offer over ${sel}`).toBe(false);
    }
  }
  // still dismissible from the keyboard
  await page.locator('#tour-offer-dismiss').focus();
  await page.keyboard.press('Escape');
  await expect(offer).toHaveCount(0);
  await context.close();
});

test('the first-run offer can be dismissed', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: `http://localhost:${HOSTED_PORT}`,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('#tour-offer-dismiss').click();
  await expect(page.locator('#tour-offer')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Open a storyboard' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#tour-offer')).toHaveCount(0);
  await context.close();
});

for (const name of TOURS)
  test(`tour “${name}”: starts from Help, every step finds its target`, async ({ page }) => {
    await openExample(page);
    await startFromHelp(page, name);
    await walk(page, name);
  });

test('tour keyboard: ← goes back, Esc closes and returns focus', async ({ page }) => {
  await openExample(page);
  await startFromHelp(page, 'Getting started');
  const pop = page.locator('#tour');
  await page.keyboard.press('ArrowRight');
  await expect(pop).toHaveAttribute('data-tour-step', '1');
  await page.keyboard.press('ArrowLeft');
  await expect(pop).toHaveAttribute('data-tour-step', '0');
  await expect(pop.locator('#tour-back')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
});
