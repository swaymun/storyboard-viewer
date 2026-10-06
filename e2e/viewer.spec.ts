import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CLI, ROOT, STORY, mcpCall } from './helpers.js';

type Sbd = {
  app: { revision: number; tab: string };
  player: {
    playing: boolean;
    time: number;
    lineId: string | null;
    debugMedia(): Array<{ cue: string; paused: boolean; time: number; muted: boolean }>;
  };
};

async function sbd<T>(page: Page, fn: (s: Sbd) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__sbd)`) as Promise<T>;
}

test.describe('served by sbd serve', () => {
  test('loads the storyboard and shows shots with script lines', async ({ page }) => {
    await page.goto('/#tab=story&view=board');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
    const shots = page.locator('article[data-shot-id]');
    await expect(shots).toHaveCount(4);
    await expect(shots.nth(0)).toHaveAttribute('data-shot-id', 'opening');
    await expect(page.getByRole('heading', { name: 'Shot 2: Maya reaches the top' })).toBeVisible();
    const climb = page.locator('[data-shot-id="climb"]');
    await expect(climb.locator('[data-line-id]').first()).toHaveText('INT. LANTERN ROOM - NIGHT');
    await expect(climb.locator('.scene_heading')).toHaveCount(1);
    // character cue + V.O. dialogue
    const opening = page.locator('[data-shot-id="opening"]');
    await expect(opening.locator('.character')).toHaveText('MAYA (V.O.)');
    await expect(opening.locator('.dialogue.vo')).toContainText('Every night for forty years');
    // shot fields
    await expect(opening.locator('[data-field="camera"] dd')).toHaveText('Extreme wide');
    // embedded image served by /api/files
    const img = opening.locator('img').first();
    await expect(img).toHaveAttribute('src', /\/api\/files\/media\/opening-color\.png/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(640);
    // canvas variant rendered as layers
    await expect(climb.locator('[data-layer-id]')).toHaveCount(3);
    // landmarks
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo', { name: 'Playback' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Views' })).toBeVisible();
  });

  test('variant carousel: buttons, dots and keyboard', async ({ page }) => {
    await page.goto('/#tab=story&view=board');
    const carousel = page.locator('#variants-opening');
    const slide = carousel.locator('[aria-roledescription="slide"]');
    await expect(slide).toHaveAttribute('data-variant-id', 'color');
    await carousel.getByRole('button', { name: 'Next variant' }).click();
    await expect(slide).toHaveAttribute('data-variant-id', 'sketch');
    await expect(slide).toHaveAttribute('aria-label', '2 of 2: Sketch');
    await carousel.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(slide).toHaveAttribute('data-variant-id', 'color');
    await carousel.getByRole('button', { name: /^Variant 2/ }).click();
    await expect(slide).toHaveAttribute('data-variant-id', 'sketch');
  });

  test('tabs: keyboard navigation, assets filter and Konva canvas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Story' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Canvas' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page
      .getByRole('navigation', { name: 'Shots' })
      .getByRole('button', { name: /Maya reaches/ })
      .click();
    await expect(page.locator('.stage canvas').first()).toBeVisible();
    await page.getByRole('button', { name: 'Maya', exact: true }).click();
    await expect(page.getByLabel('X', { exact: true })).toHaveValue('520');
    await expect(page.getByLabel('Y', { exact: true })).toHaveValue('150');

    await page.getByRole('tab', { name: 'Assets' }).click();
    await expect(page.locator('[data-asset-id]')).toHaveCount(11);
    await page
      .getByRole('group', { name: 'Filter by kind' })
      .getByRole('button', { name: /Audio/ })
      .click();
    await expect(page.locator('button[data-asset-id]')).toHaveCount(3);
    await page
      .getByRole('group', { name: 'Filter by kind' })
      .getByRole('button', { name: /All/ })
      .click();
    await page.getByLabel('Search assets by name or tag').fill('cutout');
    await expect(page.locator('button[data-asset-id]')).toHaveCount(1);
    await page.locator('button[data-asset-id="maya"]').click();
    await expect(page.getByRole('complementary')).toContainText(
      'shot climb variant layout layer maya',
    );
  });

  test('animatic playback highlights lines and plays trimmed cues', async ({ page }) => {
    await page.goto('/#tab=story&view=board');
    await page.getByRole('button', { name: 'Animatic view' }).click();
    await page.getByRole('button', { name: 'Play from Shot 1: The dark lighthouse' }).click();
    // The V.O. line starts after the scene heading + action line estimates.
    await expect.poll(() => sbd(page, (s) => s.player.time), { timeout: 8000 }).toBeGreaterThan(4);
    await expect
      .poll(() =>
        sbd(page, (s) => s.player.debugMedia().some((m) => m.cue === 'theme' && !m.paused)),
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          sbd(page, (s) =>
            s.player.debugMedia().some((m) => m.cue === 'vo-1' && !m.paused && m.time < 2.3),
          ),
        { timeout: 8000 },
      )
      .toBe(true);
    await expect(page.locator('[data-line-id][aria-current="true"]')).toHaveCount(1);
    // track mute (preview) lives in the Soundtrack panel
    await page.locator('#soundtrack-toggle').click();
    await page.getByRole('button', { name: 'Mute Music' }).click();
    await expect(page.getByRole('button', { name: 'Mute Music' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect
      .poll(() => sbd(page, (s) => s.player.debugMedia().some((m) => m.cue === 'theme' && m.muted)))
      .toBe(true);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect
      .poll(() => sbd(page, (s) => s.player.debugMedia().every((m) => m.paused)))
      .toBe(true);
    // seeking into shot 3 lands on the "Okay, Grandpa" cue segment
    await page.getByRole('button', { name: 'Next shot' }).click();
    await page.getByRole('button', { name: 'Next shot' }).click();
    await expect(page.getByRole('contentinfo')).toContainText('Shot 3');
  });

  test('live refresh after an MCP edit keeps scroll, selection and variant choice', async ({
    page,
  }) => {
    await page.goto('/#tab=story&view=board&shot=match');
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42));
    await page.locator('#variants-opening').getByRole('button', { name: 'Next variant' }).click();
    await page.locator('[data-shot-id="lamp"]').scrollIntoViewIfNeeded();
    const scrollBefore = await page.locator('main').evaluate((m) => m.scrollTop);
    const rev = await sbd(page, (s) => s.app.revision);

    const res = await mcpCall('update_shot', {
      shot_id: 'match',
      title: 'The match (edited by an agent)',
      fields: { notes: 'Live!' },
    });
    expect(res.isError).toBeFalsy();

    await expect(
      page.getByRole('heading', { name: /The match \(edited by an agent\)/ }),
    ).toBeVisible();
    await expect(page.locator('[data-shot-id="match"] [data-field="notes"] dd')).toHaveText(
      'Live!',
    );
    expect(await sbd(page, (s) => s.app.revision)).toBeGreaterThan(rev);
    expect(await page.evaluate(() => (window as unknown as { marker: number }).marker)).toBe(42); // no reload
    await expect(page.locator('#variants-opening [aria-roledescription="slide"]')).toHaveAttribute(
      'data-variant-id',
      'sketch',
    );
    await expect(page.locator('[data-shot-id="match"]')).toHaveAttribute('aria-current', 'true');
    const scrollAfter = await page.locator('main').evaluate((m) => m.scrollTop);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(40);
    await expect(page.getByRole('status').filter({ hasText: 'Updated' })).toBeVisible();

    // A new shot with script text appears in place; set_active_variant switches the shown image.
    const add = await mcpCall('add_shot', {
      id: 'gulls',
      after: 'climb',
      title: 'Gulls',
      script_text: 'Gulls circle the tower.',
      image_asset_id: 'lamp',
    });
    expect(add.isError).toBeFalsy();
    await expect(page.locator('article[data-shot-id]')).toHaveCount(5);
    await expect(page.locator('article[data-shot-id]').nth(2)).toHaveAttribute(
      'data-shot-id',
      'gulls',
    );
    await expect(page.locator('[data-shot-id="gulls"] [data-line-id]')).toHaveText(
      'Gulls circle the tower.',
    );
    // The user's choice holds until the agent changes the active variant.
    await mcpCall('set_active_variant', { shot_id: 'opening', variant_id: 'sketch' });
    await expect.poll(() => sbd(page, (s) => s.app.revision)).toBeGreaterThan(rev + 2);
    await mcpCall('set_active_variant', { shot_id: 'opening', variant_id: 'color' });
    await expect(page.locator('#variants-opening [aria-roledescription="slide"]')).toHaveAttribute(
      'data-variant-id',
      'color',
    );
  });
});

test.describe('opened in the browser (no server)', () => {
  const packed = join(ROOT, 'e2e/.tmp/minimal-packed.sbd');
  test.beforeAll(() => {
    rmSync(packed, { force: true });
    execFileSync(process.execPath, [CLI, 'pack', join(ROOT, 'examples/minimal.sbd'), '-o', packed]);
    expect(existsSync(packed)).toBe(true);
  });

  test('opens a packed .sbd and plays media sliced from the zip Blob', async ({ page }) => {
    await page.goto('/?source=local');
    await expect(page.getByRole('heading', { name: 'Open a storyboard' })).toBeVisible();
    await page.locator('#file-input').setInputFiles(packed);
    await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
    await expect(page.getByText('.sbd file', { exact: true })).toBeVisible();
    const img = page.locator('[data-shot-id="opening"] img').first();
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(640);

    // M0 spike as a test: <audio>/<video> play and seek STOREd entries sliced from the Blob.
    const result = await page.evaluate(async () => {
      const { app } = (
        window as unknown as { __sbd: { app: { mediaUrl(src: string): string | null } } }
      ).__sbd;
      const check = async (src: string, tag: 'audio' | 'video', seekTo: number) => {
        const url = app.mediaUrl(src)!;
        const el = document.createElement(tag);
        el.muted = true;
        el.preload = 'auto';
        el.src = url;
        await new Promise<void>((res, rej) => {
          el.onloadedmetadata = () => res();
          el.onerror = () => rej(new Error(`${src} failed to load`));
        });
        await el.play();
        await new Promise((r) => setTimeout(r, 250));
        const advanced = el.currentTime > 0;
        el.currentTime = seekTo;
        await new Promise<void>((res) => (el.onseeked = () => res()));
        const seeked = Math.abs(el.currentTime - seekTo) < 0.2;
        el.pause();
        return {
          url: url.slice(0, 5),
          duration: Math.round(el.duration * 10) / 10,
          advanced,
          seeked,
        };
      };
      return {
        wav: await check('media/dialogue.wav', 'audio', 4.6),
        mp4: await check('media/lamp-sweep.mp4', 'video', 2),
      };
    });
    expect(result.wav).toEqual({ url: 'blob:', duration: 7, advanced: true, seeked: true });
    expect(result.mp4).toEqual({ url: 'blob:', duration: 3, advanced: true, seeked: true });

    // The working copy is kept for offline reopen: it is in the recent list.
    await page.reload();
    const entry = page.locator('#recent-list [data-recent="zip:minimal-packed.sbd"]');
    await expect(entry).toContainText("The Keeper's Light");
    await expect(entry).toContainText('.sbd file');
    await entry.getByRole('button', { name: /^Open The Keeper's Light/ }).click();
    await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
  });

  test('recent storyboards: server and file entries, thumbnails, reopen, remove, clear', async ({
    page,
  }) => {
    // opened through `sbd serve`
    await page.goto('/');
    await expect(page.locator('article[data-shot-id]').first()).toBeVisible();
    // File → Open another storyboard… shows the start screen with the recent list
    await page.locator('#file-menu').click();
    await page.locator('#file-menu-list [data-command="open-other"]').click();
    await expect(page.getByRole('heading', { name: 'Open a storyboard' })).toBeVisible();
    // `sbd serve` keeps a shared list (config folder): one entry per storyboard path
    const server = page.locator('#recent-list li[data-recent^="served:"]');
    await expect(server).toHaveCount(1);
    await expect(server).toHaveAttribute('data-recent', `served:${STORY}`);
    await expect(server).toContainText("The Keeper's Light");
    await expect(server).toContainText('Folder · story.sbd');
    await expect(server).toContainText(/just now|min ago/);
    await expect(server.locator('img')).toBeVisible(); // thumbnail of the first shot
    // a packed file too
    await page.locator('#file-input').setInputFiles(packed);
    await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
    await page.goto('/?source=local');
    const items = page.locator('#recent-list li[data-recent]');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toHaveAttribute('data-recent', 'zip:minimal-packed.sbd');
    // one click back to the server storyboard
    await server.getByRole('button', { name: /^Open/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('article[data-shot-id]').first()).toBeVisible();
    // remove one entry, then clear the list
    await page.goto('/?source=local');
    await page
      .locator('#recent-list li[data-recent="zip:minimal-packed.sbd"]')
      .getByRole('button', { name: /^Remove/ })
      .click();
    await expect(items).toHaveCount(1);
    await page.locator('#clear-recent').click();
    await expect(page.locator('#recent-list')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#recent-list')).toHaveCount(0);
  });
});
