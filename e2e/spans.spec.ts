// 0.4.0: shots on parts of a line (several in one line), span handles, Enter-Enter, Tab in the
// editor and the keyboard way out, the Fountain guide pane, simple shots (only a picture / only a
// sound), and agent edits while typing next to sub-line shots.
// Runs against the editing server (own copy of examples/minimal.sbd, reset before each test).
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { EDIT_STORY, EXAMPLE, mcpCall, selectInScript } from './helpers.js';

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
const diskText = (rel: string) => readFileSync(join(EDIT_STORY, rel), 'utf8');
const lineId = (prefix: string): string =>
  disk('ids.json').lines.find((l: { text: string }) => l.text.startsWith(prefix)).id;
const shotRef = (id: string) => disk('ids.json').shots.find((s: { id: string }) => s.id === id);
const status = (page: Page) => page.locator('#save-status');
const cmLine = (page: Page, id: string) => page.locator(`.cm-line[data-line-id="${id}"]`);
const WAVES = 'Waves crash against black rocks. At the top of the tower, the lamp is dark.';

async function open(page: Page, hash = '#tab=story') {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
  await expect(page.locator('.cm-content')).toBeVisible();
}

/** Selects words and makes a shot from them with the floating button; returns its ID. */
async function shotFromWords(page: Page, line: string, words: string): Promise<string> {
  const before = disk('ids.json').shots.map((s: { id: string }) => s.id);
  await selectInScript(page, { line, words });
  await page.locator('#make-shot').click();
  await expect(status(page)).toHaveText('Saved');
  const id = disk('ids.json').shots.find((s: { id: string }) => !before.includes(s.id)).id;
  return id;
}

test.beforeEach(() => resetStory());

test('select part of a line → shot; two shots in one line', async ({ page }) => {
  await open(page);
  const waves = lineId('Waves crash');
  const rocks = await shotFromWords(page, waves, 'black rocks');
  expect(shotRef(rocks)).toEqual({
    id: rocks,
    lines: [waves],
    start: { line: waves, offset: WAVES.indexOf('black rocks') },
    end: { line: waves, offset: WAVES.indexOf('black rocks') + 11 },
  });
  // shot order follows the text; "opening" keeps the words before
  expect(
    disk('ids.json')
      .shots.map((s: { id: string }) => s.id)
      .slice(0, 2),
  ).toEqual(['opening', rocks]);
  expect(shotRef('opening').end).toEqual({ line: waves, offset: WAVES.indexOf('black') });
  expect(disk('manifest.json').format_version).toBe('0.2.0');
  // the mark is on exactly those words
  await expect(cmLine(page, waves).locator(`.sb-text[data-shot-id="${rocks}"]`)).toHaveText(
    'black rocks',
  );
  // a second shot in the same line, with Cmd/Ctrl+Enter
  await selectInScript(page, { line: waves, words: 'the lamp is dark.' });
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(status(page)).toHaveText('Saved');
  const lamp = disk('ids.json').shots.find(
    (s: { start?: { offset: number } }) => s.start?.offset === WAVES.indexOf('the lamp'),
  );
  expect(lamp.lines).toEqual([waves]);
  await expect(cmLine(page, waves).locator('.sb-text')).toHaveText([
    'Waves crash against',
    'black rocks',
    'the lamp is dark.',
  ]);
  await expect(page.locator(`article[data-annotation="${lamp.id}"]`)).toHaveAttribute(
    'aria-current',
    'true',
  );
  // script.fountain itself is unchanged (no markers)
  expect(diskText('script.fountain')).toBe(readFileSync(join(EXAMPLE, 'script.fountain'), 'utf8'));
});

test('drag a span handle to a word in the same line', async ({ page }) => {
  await open(page);
  const waves = lineId('Waves crash');
  const rocks = await shotFromWords(page, waves, 'black rocks');
  const end = page.locator(`.sb-handle.end[data-handle-shot="${rocks}"]`);
  await expect(end).toBeVisible();
  const h = (await end.boundingBox())!;
  // the word "tower" further along the line
  const target = await cmLine(page, waves).evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const i = n.textContent!.indexOf('tower');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i + 2);
        r.setEnd(n, i + 3);
        const b = r.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
    }
    return null;
  });
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x, target!.y, { steps: 8 });
  await expect(page.locator('.sb-preview-text')).toBeVisible();
  await page.mouse.up();
  await expect(status(page)).toHaveText('Saved');
  // snapped to the end of the word
  expect(shotRef(rocks).end).toEqual({ line: waves, offset: WAVES.indexOf('tower') + 5 });
  await expect(cmLine(page, waves).locator(`.sb-text[data-shot-id="${rocks}"]`)).toHaveText(
    'black rocks. At the top of the tower',
  );
});

test('Enter twice at the end of a shot: what you type next is outside it', async ({ page }) => {
  await open(page);
  const maya = lineId('Maya, 30s');
  await cmLine(page, maya).click();
  await page.keyboard.press('End');
  // one Enter continues the paragraph (and the shot)
  await page.keyboard.press('Enter');
  await page.keyboard.type('Her hands shake.');
  await expect(status(page)).toHaveText('Saved');
  const shake = lineId('Her hands shake.');
  expect(shotRef('climb').lines).toContain(shake);
  // Enter, Enter: a new paragraph, outside the shot
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A gull lands on the rail.');
  await expect(status(page)).toHaveText('Saved');
  const gull = lineId('A gull lands');
  for (const s of disk('ids.json').shots) expect(s.lines).not.toContain(gull);
  await expect(cmLine(page, gull).locator('.sb-text')).toHaveCount(0);

  // typing right after a sub-line shot's end stays outside it too
  const waves = lineId('Waves crash');
  const rocks = await shotFromWords(page, waves, 'black rocks');
  await cmLine(page, waves).locator(`.sb-text[data-shot-id="${rocks}"]`).click();
  await page.keyboard.press('End'); // end of the visual line…
  await selectInScript(page, { line: waves, words: 'black rocks' });
  await page.keyboard.press('ArrowRight'); // …cursor right after "rocks"
  await page.keyboard.type(' and kelp');
  await expect(status(page)).toHaveText('Saved');
  await expect(cmLine(page, waves).locator(`.sb-text[data-shot-id="${rocks}"]`)).toHaveText(
    'black rocks',
  );
  // …while typing inside it grows it
  await selectInScript(page, { line: waves, words: 'black' });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(', wet');
  await expect(status(page)).toHaveText('Saved');
  await expect(cmLine(page, waves).locator(`.sb-text[data-shot-id="${rocks}"]`)).toHaveText(
    'black, wet rocks',
  );
});

test('Tab stays in the editor (screenplay elements); Esc then Tab leaves it', async ({ page }) => {
  await open(page);
  const editor = page.locator('#script-editor');
  const maya = lineId('Maya, 30s');
  await cmLine(page, maya).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // empty line: Tab → character (upper case as you type)
  await page.keyboard.press('Tab');
  await expect(editor).toBeFocused();
  await expect(page.locator('.sb-element-hint')).toHaveText('CHARACTER');
  await page.keyboard.type('nora');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Who lit it?');
  // Tab at the end of dialogue: a parenthetical below
  await page.keyboard.press('Tab');
  await expect(editor).toBeFocused();
  await page.keyboard.type('beat');
  await page.keyboard.press('Tab'); // out of the parenthetical: next dialogue line
  await page.keyboard.type('Nobody did.');
  await expect(status(page)).toHaveText('Saved');
  const script = diskText('script.fountain');
  expect(script).toContain('NORA\nWho lit it?\n(beat)\nNobody did.');
  expect(script).not.toContain('\t');
  const nora = disk('ids.json').lines.find((l: { text: string }) => l.text === 'Who lit it?');
  expect(nora.type).toBe('dialogue');
  expect(disk('ids.json').lines.find((l: { text: string }) => l.text === '(beat)').type).toBe(
    'parenthetical',
  );
  // empty line: Tab cycles Character → Scene heading
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(status(page)).toHaveText('Saved');
  expect(diskText('script.fountain')).toContain('Nobody did.\n\nINT. ');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab'); // back to action: the line is empty again
  await expect(status(page)).toHaveText('Saved');
  expect(diskText('script.fountain')).not.toContain('INT. \n');

  // the keyboard way out: Esc, then Tab moves focus on (no trap)
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
  // and Shift+Tab comes back
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toBeFocused();
});

test('Fountain guide: Help opens a left pane; × closes; remembered after reload', async ({
  page,
}) => {
  await open(page);
  const guide = page.locator('#fountain-guide');
  await expect(guide).toHaveCount(0);
  await page.locator('#help-menu').click();
  await page.locator('#help-menu-list [data-command="toggle-guide"]').click();
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: 'Fountain syntax' })).toBeVisible();
  for (const term of ['Scene heading', 'Parenthetical', 'Transition', 'Boneyard', 'Lyrics'])
    await expect(guide.locator('dt', { hasText: term }).first()).toBeVisible();
  // left of the script
  const g = (await guide.boundingBox())!;
  const ed = (await page.locator('.cm-content').boundingBox())!;
  expect(g.x + g.width).toBeLessThanOrEqual(ed.x);
  await page.reload();
  await expect(guide).toBeVisible();
  // keyboard: focus inside the pane, Esc closes
  await guide.locator('#guide-close').focus();
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(page.locator('#help-menu')).toBeFocused();
  // reopen, then close with ×
  await page.locator('#help-menu').click();
  await expect(page.locator('#help-menu-list [data-command="toggle-guide"]')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.locator('#help-menu-list [data-command="toggle-guide"]').click();
  await expect(guide).toBeVisible();
  await page.locator('#guide-close').click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(guide).toHaveCount(0);
});

test('simple shots: only a picture, only a sound; the card shows just that', async ({ page }) => {
  await open(page);
  // a shot without script text: the card offers "Add image" and nothing else
  await page.locator('#shot-menu').click();
  await page.locator('#shot-menu-list [data-command="lineless-shot"]').click();
  await expect(status(page)).toHaveText('Saved');
  const id = disk('ids.json').shots.find((s: { lines: string[] }) => !s.lines.length).id;
  const card = page.locator(`article[data-annotation="${id}"]`);
  await expect(card).toHaveAttribute('aria-current', 'true');
  await expect(card.locator(`[data-add-picture="${id}"]`)).toBeVisible();
  await expect(card.locator(`[data-add-picture="${id}"]`)).not.toHaveClass(/slim/);
  expect((await card.locator(`[data-add-picture="${id}"]`).boundingBox())!.height).toBeGreaterThan(
    60,
  );
  await expect(card.locator('[data-audio-section], [data-field], input')).toHaveCount(0);
  // only a picture
  await card.locator(`[data-add-picture="${id}"]`).click();
  await page.getByRole('dialog').locator('[data-asset-id="lamp"]').first().click();
  await expect(card.locator('[aria-roledescription="carousel"] img')).toBeVisible();
  await expect(card.locator('[data-audio-section]')).toHaveCount(0);
  await expect(status(page)).toHaveText('Saved');
  expect(disk(`shots/${id}.json`).variants).toHaveLength(1);

  // another one with only a sound: "+" → Sound…
  await page.locator('#shot-menu').click();
  await page.locator('#shot-menu-list [data-command="lineless-shot"]').click();
  await expect(status(page)).toHaveText('Saved');
  const ids = disk('ids.json')
    .shots.filter((s: { lines: string[] }) => !s.lines.length)
    .map((s: { id: string }) => s.id);
  const sid = ids.find((x: string) => x !== id);
  const scard = page.locator(`article[data-annotation="${sid}"]`);
  await scard.locator(`#add-to-${sid}`).click();
  await page.locator('[data-command="add-sound"]').click();
  await scard.locator('#add-shot-sound').click();
  await page.getByRole('dialog').locator('[data-asset-id="match-strike"]').first().click();
  await expect(scard.locator(`[data-audio-section="${sid}"]`)).toBeVisible();
  await expect(status(page)).toHaveText('Saved');
  const cue = disk('timeline.json').cues.find(
    (c: { target: { shot?: string } }) => c.target.shot === sid,
  );
  expect(cue.asset).toBe('match-strike');
  // no picture yet: the drop target is still offered (a small row under the sound, not a big
  // box), but no details or title
  const slim = scard.locator(`[data-add-picture="${sid}"]`);
  await expect(slim).toBeVisible();
  await expect(slim).toHaveClass(/slim/);
  expect((await slim.boundingBox())!.height).toBeLessThan(36);
  const sound = (await scard.locator(`[data-audio-section="${sid}"]`).boundingBox())!;
  expect((await slim.boundingBox())!.y).toBeGreaterThan(sound.y);
  await expect(scard.locator('[data-annotation-title]')).toHaveCount(0);
});

test('agent edits the line of a sub-line shot while the user types elsewhere', async ({ page }) => {
  await open(page);
  const waves = lineId('Waves crash');
  const made = await shotFromWords(page, waves, 'black rocks');
  await page.locator('#file-menu').click();
  await page.getByRole('menuitemcheckbox', { name: 'Save automatically' }).click();
  const mine = lineId('Maya, 30s');
  await cmLine(page, mine).click();
  await page.keyboard.press('End');
  const call = mcpCall('update_line', { line_id: waves, text: `Cold ${WAVES}` }, EDIT_STORY);
  await page.keyboard.type(' She pauses', { delay: 60 });
  expect((await call).isError).toBeFalsy();
  await expect(page.locator('[data-toast="agent"]')).toContainText('Updated by agent');
  await page.keyboard.type(', listening.');
  // the shot is still on its words after the agent's edit
  await expect(cmLine(page, waves).locator(`.sb-text[data-shot-id="${made}"]`)).toHaveText(
    'black rocks',
  );
  await page.keyboard.press('ControlOrMeta+s');
  await expect(status(page)).toHaveText('Saved');
  expect(diskText('script.fountain')).toContain(`Cold ${WAVES}`);
  expect(diskText('script.fountain')).toContain('She pauses, listening.');
  expect(shotRef(made).start).toEqual({ line: waves, offset: `Cold ${WAVES}`.indexOf('black') });
});
