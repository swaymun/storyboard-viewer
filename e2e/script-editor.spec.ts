// Script view (free-form Fountain editor with shot annotations), themes, details and tags.
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
const shotLines = (id: string): string[] =>
  disk('ids.json').shots.find((s: { id: string }) => s.id === id).lines;
const status = (page: Page) => page.locator('#save-status');
const cmLine = (page: Page, id: string) => page.locator(`.cm-line[data-line-id="${id}"]`);

async function open(page: Page, hash = '#tab=story') {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
  if (!hash.includes('view=board')) await expect(page.locator('.cm-content')).toBeVisible();
}

async function autosaveOff(page: Page) {
  await page.locator('#file-menu').click();
  await page.getByRole('menuitemcheckbox', { name: 'Save automatically' }).click();
}

test.beforeEach(() => resetStory());

test('themes: Appearance menu, persistence and System', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'paper'); // System → light pair
  await page.locator('#view-menu').click();
  await page.getByRole('menuitem', { name: /Appearance/ }).click();
  await page.getByRole('menuitemradio', { name: 'Jinshi Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'jinshi-dark');
  await expect(page.getByRole('menuitemradio', { name: 'Jinshi Dark' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(31, 17, 41)');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'jinshi-dark');

  // System follows prefers-color-scheme with the chosen pair
  await page.locator('#view-menu').click();
  await page.getByRole('menuitem', { name: /Appearance/ }).click();
  await page.getByRole('menuitem', { name: /System dark theme/ }).click();
  await page.getByRole('menuitemradio', { name: 'Maomao Dark' }).click();
  await page.getByRole('menuitem', { name: 'System dark theme' }).click(); // back
  await page.getByRole('menuitemradio', { name: /^System/ }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'maomao-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'paper');
  expect(await page.evaluate(() => localStorage.getItem('sbd:theme'))).toBe('system');
});

test('free-form typing: element types inferred, IDs of untouched and edited lines kept', async ({
  page,
}) => {
  await open(page);
  const before = disk('ids.json').lines.map((l: { id: string }) => l.id);
  const edited = lineId('Maya, 30s');
  // edit inside a line
  await cmLine(page, edited).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Wind howls.');
  // the status says so right away, before the typed text is even committed (QA B1)
  await expect(status(page)).toHaveText('Unsaved changes', { timeout: 150 });
  // new paragraph with a character cue and dialogue, plus a scene heading
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('MAYA\nHere goes nothing.\n\nEXT. BALCONY - NIGHT');
  await expect(page.locator('.cm-line.cm-fx-character', { hasText: 'MAYA' }).first()).toBeVisible();
  await expect(page.locator('.cm-line.cm-fx-scene_heading', { hasText: 'BALCONY' })).toBeVisible();
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  const ids = disk('ids.json');
  const byText = (t: string) => ids.lines.find((l: { text: string }) => l.text.startsWith(t));
  for (const id of before) expect(ids.lines.some((l: { id: string }) => l.id === id)).toBe(true);
  expect(byText('Maya, 30s').id).toBe(edited);
  expect(byText('Maya, 30s').text).toMatch(/Wind howls\.$/);
  expect(byText('Here goes nothing.').type).toBe('dialogue');
  expect(byText('EXT. BALCONY').type).toBe('scene_heading');
  // Enter, Enter after shot 2's last line started a new paragraph: outside shot 2 (and so is
  // the new scene heading)
  const climb = ids.shots.find((s: { id: string }) => s.id === 'climb').lines;
  expect(climb).not.toContain(byText('Here goes nothing.').id);
  expect(climb).not.toContain(byText('EXT. BALCONY').id);
  expect(diskText('script.fountain')).toContain('MAYA\nHere goes nothing.\n\nEXT. BALCONY - NIGHT');
  // the new line is addressable in the DOM right away
  await expect(cmLine(page, byText('Here goes nothing.').id)).toHaveText('Here goes nothing.');

  // undo goes through the app history (one step for the burst of typing)
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.cm-content')).not.toContainText('BALCONY');
  await expect(page.locator('#redo')).toHaveAttribute('aria-label', /Redo: Edit script/);
});

test('make a shot from selected lines (Cmd/Ctrl+Enter), shot without lines', async ({ page }) => {
  await open(page);
  const a = lineId('She strikes');
  const b = lineId('The lamp ROARS');
  await selectInScript(page, { line: a }, { line: b });
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('article[data-shot-id]')).toHaveCount(5);
  await expect(status(page)).toHaveText('Saved');
  const shots = disk('ids.json').shots;
  const made = shots.find((s: { lines: string[] }) => s.lines.includes(a));
  // whole lines selected: a whole-line shot (no character offsets)
  expect(made).toEqual({ id: made.id, lines: [a, b] });
  expect(shots.map((s: { id: string }) => s.id).indexOf(made.id)).toBe(3);
  expect(shotLines('match')).not.toContain(a);
  expect(shotLines('lamp')).not.toContain(b);
  // the new shot is highlighted on its lines and its card is open
  await expect(cmLine(page, a)).toHaveAttribute('data-shot-id', made.id);
  await expect(page.locator(`article[data-annotation="${made.id}"]`)).toHaveAttribute(
    'aria-current',
    'true',
  );

  // a shot without script text (Shot menu) appears as a marker between lines
  await page.locator('#shot-menu').click();
  await page.locator('#shot-menu-list [data-command="lineless-shot"]').click();
  await expect(page.locator('.cm-content [data-lineless]')).toHaveCount(1);
  await expect(status(page)).toHaveText('Saved');
  expect(disk('ids.json').shots.filter((s: { lines: string[] }) => !s.lines.length)).toHaveLength(
    1,
  );
});

test('drag a shot’s end handle to take in the next lines', async ({ page }) => {
  await open(page, '#tab=story&shot=climb');
  const target = lineId('Okay, Grandpa');
  const handle = page.locator('.sb-handle.end[data-handle-shot="climb"]');
  await expect(handle).toBeVisible();
  const h = (await handle.boundingBox())!;
  const t = (await page.locator(`.cm-line[data-line-id="${target}"] .sb-text`).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width - 2, t.y + t.height / 2, { steps: 8 });
  await expect(page.locator('.sb-preview-text').first()).toBeVisible();
  await page.mouse.up();
  await expect(status(page)).toHaveText('Saved');
  expect(shotLines('climb')).toEqual(expect.arrayContaining([lineId('(whispering'), target]));
  expect(shotLines('match')).toEqual([lineId('She strikes')]);
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Change shot text');
});

test('reorder shots beside the script: lines move with the shot', async ({ page }) => {
  await open(page);
  const order = () =>
    page
      .locator('article[data-annotation]')
      .evaluateAll((els) =>
        els
          .toSorted((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top)
          .map((e) => e.getAttribute('data-annotation')),
      );
  await expect.poll(order).toEqual(['opening', 'climb', 'match', 'lamp']);
  // keyboard: grip + ArrowUp
  await page.locator('[data-annotation="lamp"] .grip').focus();
  await page.keyboard.press('ArrowUp');
  await expect(status(page)).toHaveText('Saved');
  expect(disk('ids.json').shots.map((s: { id: string }) => s.id)).toEqual([
    'opening',
    'climb',
    'lamp',
    'match',
  ]);
  const script = diskText('script.fountain');
  expect(script.indexOf('The lamp ROARS')).toBeLessThan(script.indexOf('She strikes'));
  await expect.poll(order).toEqual(['opening', 'climb', 'lamp', 'match']);

  // pointer drag of the grip above the first card
  const grip = (await page.locator('[data-annotation="match"] .grip').boundingBox())!;
  const first = (await page.locator('[data-annotation="opening"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 4, first.y + 4, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => disk('ids.json').shots.map((s: { id: string }) => s.id))
    .toEqual(['match', 'opening', 'climb', 'lamp']);
  const lines = disk('ids.json').lines.map((l: { id: string }) => l.id);
  expect(lines[0]).toBe(shotLines('match')[0]); // the script now starts with that shot's lines
});

test('add a custom detail and tags; filter shots by tag', async ({ page }) => {
  await open(page, '#tab=story&shot=climb');
  const card = page.locator('article[data-annotation="climb"]');
  await expect(card).toHaveAttribute('aria-current', 'true');
  // existing details start folded into one summary row; it expands them
  const rows = card.locator('[data-field]');
  await expect(rows).toHaveCount(0);
  await card.locator('[data-shot-summary="climb"]').click();
  // only fields with a value are shown
  await expect(rows.first()).toBeVisible();
  const shown = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-field')));
  const values = disk('shots/climb.json').fields;
  expect(shown.toSorted()).toEqual(
    Object.keys(values)
      .filter((k) => values[k] !== '' && values[k] !== null)
      .toSorted(),
  );
  // a new field name typed on the spot becomes a field definition
  const add = card.getByRole('combobox', { name: /Add detail/ });
  await add.fill('Weather');
  await add.press('Enter');
  const input = card.locator('[data-field="weather"] input');
  await expect(input).toBeFocused();
  await input.fill('Storm rolling in');
  await input.press('Tab');
  // tags: type + Enter, autocomplete from other shots
  const tag = card.getByRole('combobox', { name: /Add a tag/ });
  await tag.fill('night');
  await tag.press('Enter');
  await tag.fill('act 1');
  await tag.press('Enter');
  await expect(card.locator('[data-tag]')).toHaveCount(2);
  await expect(status(page)).toHaveText('Saved');
  const m = disk('manifest.json');
  expect(m.shot_fields.find((f: { id: string }) => f.id === 'weather')).toMatchObject({
    label: 'Weather',
    type: 'text',
  });
  expect(disk('shots/climb.json').fields.weather).toBe('Storm rolling in');
  expect(disk('shots/climb.json').tags).toEqual(['night', 'act-1']);
  // remove a tag
  await card
    .getByRole('button', { name: 'Remove tag act-1 from Shot 2: Maya reaches the top' })
    .click();
  await expect(card.locator('[data-tag]')).toHaveCount(1);

  // filter in the Board view
  await page.locator('#view-board').click();
  await page.locator('[data-filter-tag="night"]').click();
  await expect(page.locator('article[data-shot-id]')).toHaveCount(1);
  await expect(page.locator('article[data-shot-id]')).toHaveAttribute('data-shot-id', 'climb');
  await expect(page.getByText('1 of 4 shots')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('article[data-shot-id]')).toHaveCount(4);
  await expect(status(page)).toHaveText('Saved');
  expect(disk('shots/climb.json').tags).toEqual(['night']);
});

test('agent edit while typing: merged, typed text and cursor kept', async ({ page }) => {
  await open(page);
  await autosaveOff(page);
  const mine = lineId('Maya, 30s');
  const theirs = lineId('The lamp ROARS');
  await cmLine(page, mine).click();
  await page.keyboard.press('End');
  // the agent edits another line while the user keeps typing (text not yet committed)
  const call = mcpCall(
    'update_line',
    { line_id: theirs, text: 'The lamp ROARS to life. The sea glows.' },
    EDIT_STORY,
  );
  await page.keyboard.type(' She pauses', { delay: 80 });
  expect((await call).isError).toBeFalsy();
  await expect(page.locator('[data-toast="agent"]')).toContainText('Updated by agent');
  await expect(cmLine(page, theirs)).toHaveText('The lamp ROARS to life. The sea glows.');
  // keep typing: the cursor is still at the end of the user's sentence
  await page.keyboard.type(', listening.');
  await expect(cmLine(page, mine)).toHaveText(
    'Maya, 30s, climbs the last step, out of breath. She holds a matchbox. She pauses, listening.',
  );
  await page.keyboard.press('ControlOrMeta+s');
  await expect(status(page)).toHaveText('Saved');
  const script = diskText('script.fountain');
  expect(script).toContain('She holds a matchbox. She pauses, listening.');
  expect(script).toContain('The lamp ROARS to life. The sea glows.');
  const ids = disk('ids.json');
  expect(ids.lines.find((l: { id: string }) => l.id === mine).text).toMatch(/listening\.$/);
  expect(ids.lines.find((l: { id: string }) => l.id === theirs).text).toMatch(/sea glows\.$/);
});

test('Board: double-click a line opens it in the script; drag a line into another shot', async ({
  page,
}) => {
  await open(page, '#tab=story&view=board');
  const id = lineId('She strikes');
  // Alt+↓ on the last line of "match" moves it into "lamp" (first line)
  await page.locator(`.script [data-line-id="${id}"]`).click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(status(page)).toHaveText('Saved');
  expect(shotLines('lamp')[0]).toBe(id);
  expect(shotLines('match')).not.toContain(id);
  // drag "(whispering)" from "match" onto the last line of "climb" (lands before it)
  const paren = lineId('(whispering');
  const target = page.locator(`.script [data-line-id="${lineId('Maya, 30s')}"]`);
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const from = (await page.locator(`.script [data-line-id="${paren}"]`).boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y - 20, { steps: 5 });
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => shotLines('climb'))
    .toEqual([lineId('INT. LANTERN'), paren, lineId('Maya, 30s')]);
  const text = diskText('script.fountain');
  expect(text.indexOf('(whispering)')).toBeLessThan(text.indexOf('Maya, 30s'));
  expect(text.indexOf('(whispering)')).toBeGreaterThan(text.indexOf('INT. LANTERN ROOM'));
  // double-click → Script view, cursor on that line
  await page.locator(`.script [data-line-id="${id}"]`).dblclick();
  await expect(page.locator('#view-script')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#script-editor')).toBeFocused();
  await page.keyboard.type('!');
  await expect(cmLine(page, id)).toHaveText('She strikes a match. The flame flickers.!');
});

test('save status: "Unsaved" while typing, on disk about a second after the last key', async ({
  page,
}) => {
  await open(page);
  const id = lineId('She strikes');
  await cmLine(page, id).click();
  await page.keyboard.press('End');
  await expect(status(page)).not.toHaveText('Unsaved changes');
  await page.keyboard.type(' It hisses.');
  const typed = Date.now();
  await expect(status(page)).toHaveText(/Unsaved changes|Saving…/, { timeout: 150 });
  await expect.poll(() => diskText('script.fountain'), { intervals: [50] }).toContain('It hisses.');
  const latency = Date.now() - typed;
  expect(latency).toBeLessThan(1500); // target ~1 s (commit 0.3 s + autosave 0.35 s + write)
  await expect(status(page)).toHaveText('Saved');
  expect(disk('ids.json').lines.find((l: { id: string }) => l.id === id).text).toMatch(/hisses\.$/);
});

test('reordering cards with Alt+↑/↓ keeps keyboard focus (consecutive moves)', async ({ page }) => {
  await open(page);
  const order = () => disk('ids.json').shots.map((s: { id: string }) => s.id);
  const select = page.locator('[data-annotation="climb"] .select');
  await select.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(order).toEqual(['opening', 'match', 'climb', 'lamp']);
  await expect(select).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(order).toEqual(['opening', 'match', 'lamp', 'climb']);
  await expect(select).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(order).toEqual(['opening', 'climb', 'match', 'lamp']);
  await expect(select).toBeFocused();
  // the grip keeps focus too (plain ↑/↓ on the grip)
  const grip = page.locator('[data-annotation="lamp"] .grip');
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(order).toEqual(['opening', 'lamp', 'climb', 'match']);
  await expect(grip).toBeFocused();
});

test('script highlight: calm marks on the words only, no gutter, handles on hover', async ({
  page,
}) => {
  await open(page, '#tab=story&shot=climb');
  await expect(page.locator('.sb-band, .sb-gutter')).toHaveCount(0);
  await expect(page.locator('.cm-gutters')).toHaveCount(0);
  // the tint is on the words (a mark inside the line), not on the line box
  const line = cmLine(page, lineId('Maya, 30s'));
  await expect(line.locator('.sb-text.sb-active')).toHaveText(/^Maya, 30s/);
  const lineBg = await line.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(lineBg).toBe('rgba(0, 0, 0, 0)');
  // handles at the ends of the open shot; another shot shows them on hover
  await expect(page.locator('.sb-handle[data-handle-shot="climb"]')).toHaveCount(2);
  await expect(page.locator('.sb-handle[data-handle-shot="match"]')).toHaveCount(0);
  await cmLine(page, lineId('Okay, Grandpa')).locator('.sb-text').hover();
  await expect(page.locator('.sb-handle[data-handle-shot="match"]')).toHaveCount(2);
  // no hint text above the editor
  await expect(page.locator('#script-help')).toHaveCount(0);
});

test('context menus: script lines (mouse and Shift+F10), shot cards, keyboard', async ({
  page,
}) => {
  await open(page);
  const a = lineId('She strikes');
  // right-click a line → Make shot from line
  await cmLine(page, a).click({ button: 'right' });
  const menu = page.locator('[data-context-menu] [role="menu"]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Make shot from line' }).click();
  await expect(page.locator('article[data-annotation]')).toHaveCount(5);
  await expect(status(page)).toHaveText('Saved');
  const made = disk('ids.json').shots.find((s: { lines: string[] }) => s.lines.includes(a));
  expect(made.lines).toEqual([a]);

  // keyboard: Shift+F10 in the editor → Add to previous shot (back into "match")
  await cmLine(page, a).click();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /Add to previous shot \(Shot 3/ }).click();
  await expect(status(page)).toHaveText('Saved');
  expect(shotLines('match')).toContain(a);
  // focus went back to the editor
  await expect(page.locator('#script-editor')).toBeFocused();

  // Esc closes and returns focus; Remove from shot
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#script-editor')).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Remove from shot' }).click();
  await expect(status(page)).toHaveText('Saved');
  expect(shotLines('match')).not.toContain(a);

  // shot card: right-click → Duplicate; the card's keyboard menu → Move down
  const card = page.locator('article[data-annotation="opening"]');
  await card.locator('.select').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(status(page)).toHaveText('Saved');
  expect(disk('ids.json').shots).toHaveLength(6);
  await card.locator('.select').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect
    .poll(() =>
      disk('ids.json')
        .shots.map((s: { id: string }) => s.id)
        .indexOf('opening'),
    )
    .toBe(1);
  await expect(card.locator('.select')).toBeFocused();

  // shot card → Copy shot ID
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('[data-annotation="lamp"] .select').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy shot ID' }).click();
  await expect(page.getByText('Copied shot ID lamp')).toBeVisible();
});

test('details are free text with suggestions (no dropdowns)', async ({ page }) => {
  await open(page, '#tab=story&shot=climb');
  const card = page.locator('article[data-annotation="climb"]');
  await card.locator('[data-shot-summary="climb"]').click();
  await expect(card.locator('select, datalist')).toHaveCount(0);
  const size = card.getByRole('combobox', { name: /^Shot size of/ });
  await expect(size).toHaveValue('Medium wide');
  await size.click();
  // presets show up as suggestions on focus, filtered while typing
  const list = card.getByRole('listbox', { name: /Suggestions for Shot size/ });
  await expect(list).toBeVisible();
  await expect(list.getByRole('option', { name: 'Close-up', exact: true })).toBeVisible();
  await size.fill('clo');
  await expect(list.getByRole('option')).toHaveText([
    'Medium close-up',
    'Close-up',
    'Extreme close-up',
  ]);
  await size.press('ArrowDown');
  await size.press('ArrowDown');
  await size.press('Enter');
  await expect(size).toHaveValue('Close-up');
  // anything else is fine too
  const movement = card.getByRole('combobox', { name: /^Movement of/ });
  await movement.fill('Slow push in from the stairs');
  await movement.press('Tab');
  await expect(status(page)).toHaveText('Saved');
  expect(disk('shots/climb.json').fields).toMatchObject({
    camera: 'Close-up',
    movement: 'Slow push in from the stairs',
  });
  // Add detail: preset fields are suggestions (click one)
  const add = card.getByRole('combobox', { name: /Add detail/ });
  await add.click();
  await card.locator('[data-suggestion="Transition"]').click();
  const transition = card.getByRole('combobox', { name: /^Transition of/ });
  await expect(transition).toBeFocused();
  await transition.fill('Match cut on the flame');
  await transition.press('Enter');
  await expect(status(page)).toHaveText('Saved');
  expect(disk('shots/climb.json').fields.transition).toBe('Match cut on the flame');
});

test('menu bar: keyboard navigation (F10, arrows, Esc) and commands', async ({ page }) => {
  await open(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('F10');
  const file = page.locator('#file-menu');
  await expect(file).toBeFocused();
  await expect(page.getByRole('menubar')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#file-menu-list')).toBeVisible();
  await expect(page.locator('#file-menu-list [role^="menuitem"]').first()).toBeFocused();
  await page.keyboard.press('ArrowRight'); // → Edit menu, open on its first item
  await expect(page.locator('#file-menu-list')).toHaveCount(0);
  await expect(page.locator('#edit-menu-list')).toBeVisible();
  await expect(page.locator('#edit-menu')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#edit-menu-list')).toHaveCount(0);
  await expect(page.locator('#edit-menu')).toBeFocused();
  await page.keyboard.press('ArrowRight'); // View (closed)
  await expect(page.locator('#view-menu')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-menu-list')).toBeVisible();
  // type-ahead + shortcut labels; View → Board
  await page.keyboard.press('b');
  await expect(page.getByRole('menuitemradio', { name: 'Board' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-board')).toHaveAttribute('aria-checked', 'true');
  // shortcuts are shown in the menus
  await page.locator('#file-menu').click();
  await expect(page.getByRole('menuitem', { name: /Save/ }).first()).toContainText(/(⌘|Ctrl\+)S/);
  await page.keyboard.press('Escape');
  // Shot menu acts on the selected shot
  await page.locator('#view-script').click();
  await page.locator('[data-annotation="lamp"] .select').click();
  await page.locator('#shot-menu').click();
  await expect(page.locator('#shot-menu-list')).toContainText('Shot 4: Light returns');
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect
    .poll(() => disk('ids.json').shots.map((s: { id: string }) => s.id))
    .toEqual(['opening', 'climb', 'lamp', 'match']);
});
