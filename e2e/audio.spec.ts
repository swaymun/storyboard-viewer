// Audio, folded into the shots (0.3.0; replaces the Timeline tab tests): a shot's Audio section
// (assign trimmed segments to lines, I / O / A with auto-advance into the next shot, re-trim),
// the Soundtrack panel (story-wide cues, track mute / solo, lanes), attaching audio from the
// script's context menu and using assets from the Assets tab's context menu.
// Runs against the editing server (own copy of examples/minimal.sbd, reset before each test).
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { EDIT_STORY, EXAMPLE } from './helpers.js';

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
const lineId = (prefix: string): string =>
  disk('ids.json').lines.find((l: { text: string }) => l.text.startsWith(prefix)).id;
const status = (page: Page) => page.locator('#save-status');
type CueJson = { id: string; asset: string; in?: number; out?: number; target: { line?: string } };
const cueOn = (line: string): CueJson | undefined =>
  disk('timeline.json').cues.find((c: CueJson) => c.target.line === line);

async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The Keeper's Light");
}

async function openAudio(page: Page, shot: string) {
  await open(page, `#tab=story&shot=${shot}`);
  const card = page.locator(`article[data-annotation="${shot}"]`);
  await expect(card).toHaveAttribute('aria-current', 'true');
  const section = card.locator(`[data-audio-section="${shot}"]`);
  if (await section.count()) await section.locator('.sec-head').click();
  // a shot without sound shows no Audio section until asked for with "+" → Sound
  else {
    await card.locator(`#add-to-${shot}`).click();
    await page.locator('[data-command="add-sound"]').click();
  }
  await expect(card.locator('[data-audio-lines]')).toBeVisible();
  return card;
}

test.beforeEach(() => resetStory());

test('there is no Timeline tab; old links open the Soundtrack panel', async ({ page }) => {
  await open(page, '#tab=timeline');
  await expect(page.getByRole('tab')).toHaveText(['Story', 'Canvas', 'Assets']);
  await expect(page.locator('#tab-story')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#soundtrack')).toBeVisible();
});

test('shot Audio: assign a trimmed segment to a line, advance, then re-trim it', async ({
  page,
}) => {
  const card = await openAudio(page, 'lamp');
  const id = lineId('The lamp ROARS');
  const next = lineId('Some things');
  await expect(page.locator('#audio-source')).toHaveAttribute('data-source-id', 'dialogue');
  await card.locator(`[data-audio-line="${id}"]`).click();
  await page.locator('#mark-in').fill('4.3');
  await page.locator('#mark-in').press('Tab');
  await page.locator('#mark-out').fill('5.5');
  await page.locator('#mark-out').press('Tab');
  await page.locator('#assign-line').click();
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Assign audio to line');
  // the next line is selected and the next segment starts where this one ended
  await expect(page.locator('#mark-in')).toHaveValue('5.5');
  await expect(card.locator(`[data-audio-line="${next}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator(`[data-audio-line="${next}"]`)).toBeFocused();
  await expect(status(page)).toHaveText('Saved');
  expect(cueOn(id)).toMatchObject({ asset: 'dialogue', in: 4.3, out: 5.5, track: 'dialogue' });

  // pick the line again → its cue; trim the out point
  await card.locator(`[data-audio-line="${id}"]`).click();
  await expect(card.locator('.cue-panel')).toBeVisible();
  await expect(page.locator('#mark-out')).toHaveValue('5.5');
  await page.locator('#mark-out').fill('5.9');
  await page.locator('#mark-out').press('Tab');
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Trim cue');
  await expect(status(page)).toHaveText('Saved');
  await expect.poll(() => cueOn(id)?.out).toBe(5.9);
  // the animatic timing follows: the line lasts as long as its cue
  const t = await page.evaluate(
    (lid) =>
      (
        window as unknown as {
          __sbd: {
            player: {
              animatic: {
                shots: Array<{ lines: Array<{ id: string; start: number; end: number }> }>;
              };
            };
          };
        }
      ).__sbd.player.animatic.shots
        .flatMap((s) => s.lines)
        .find((l) => l.id === lid),
    id,
  );
  expect(t!.end - t!.start).toBeCloseTo(1.6, 1);

  // cue details: gain mute, delete with the keyboard
  await card.getByRole('button', { name: 'Mute cue' }).click();
  await expect.poll(() => (cueOn(id) as { gain?: number } | undefined)?.gain).toBe(0);
  await card.locator(`[data-audio-line="${id}"]`).focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Delete cue');
  await expect.poll(() => cueOn(id)).toBeUndefined();
});

test('keyboard: playhead, I / O / A, auto-advance into the next shot', async ({ page }) => {
  const card = await openAudio(page, 'climb');
  const last = lineId('Maya, 30s'); // last line of "climb"
  const nextShotLine = lineId('(whispering'); // first line of "match"
  await card.locator(`[data-audio-line="${last}"]`).click();
  // click the waveform to move the playhead (between existing cue regions: 4.1–4.5 s is free)
  const canvas = card.locator('[data-waveform] canvas');
  const box = (await canvas.boundingBox())!;
  const x = (t: number) => box.x + (t / 7) * box.width;
  await page.mouse.click(x(4.18), box.y + box.height / 2);
  await page.keyboard.press('i');
  await page.mouse.click(x(4.42), box.y + box.height / 2);
  await page.keyboard.press('o');
  const markIn = Number(await page.locator('#mark-in').inputValue());
  const markOut = Number(await page.locator('#mark-out').inputValue());
  expect(markIn).toBeCloseTo(4.18, 1);
  expect(markOut).toBeCloseTo(4.42, 1);
  await page.keyboard.press('a');
  await expect(page.locator('#undo')).toHaveAttribute('aria-label', 'Undo: Assign audio to line');
  // on to the next line, which is in the next shot: its card opens, focus follows
  const match = page.locator('article[data-annotation="match"]');
  await expect(match).toHaveAttribute('aria-current', 'true');
  await expect(match.locator(`[data-audio-line="${nextShotLine}"]`)).toBeFocused();
  await expect(page.locator('#mark-in')).toHaveValue(String(markOut));
  await expect(status(page)).toHaveText('Saved');
  expect(cueOn(last)).toMatchObject({ asset: 'dialogue', in: markIn, out: markOut });
  // ↓ moves to the next line
  await page.keyboard.press('ArrowDown');
  await expect(match.locator(`[data-audio-line="${lineId('Okay, Grandpa')}"]`)).toBeFocused();
});

test('Soundtrack panel: story-wide cue, saved track mute, solo, lanes open shot cues', async ({
  page,
}) => {
  await open(page, '#tab=story');
  await page.locator('#view-menu').click();
  await page.getByRole('menuitemcheckbox', { name: 'Soundtrack' }).click();
  const panel = page.locator('#soundtrack');
  await expect(panel).toBeVisible();
  // the music under the whole story
  await panel.locator('.story-cues [data-cue-id="theme"]').click();
  await expect(panel.locator('.cue-panel[data-cue-id="theme"]')).toBeVisible();
  await expect(panel.locator('#audio-source')).toHaveAttribute('data-source-id', 'music');
  await panel.getByRole('button', { name: 'Mute cue' }).click();
  await expect
    .poll(() => disk('timeline.json').cues.find((c: { id: string }) => c.id === 'theme').gain)
    .toBe(0);
  // track mute is saved; solo is a preview
  await panel.getByRole('button', { name: 'Mute track Music' }).click();
  await expect
    .poll(
      () =>
        disk('timeline.json').tracks.find((t: { id: string; muted?: boolean }) => t.id === 'music')
          .muted,
    )
    .toBe(true);
  const solo = panel.getByRole('button', { name: 'Solo track SFX' });
  await solo.click();
  await expect(solo).toHaveAttribute('aria-pressed', 'true');
  // a shot's cue in the lanes opens in that shot's card
  await panel.locator('.lane [data-cue-id="maya-1"]').click();
  const match = page.locator('article[data-annotation="match"]');
  await expect(match).toHaveAttribute('aria-current', 'true');
  await expect(match.locator('.cue-panel[data-cue-id="maya-1"]')).toBeVisible();
  // Esc in the panel (nothing selected there) closes it
  await page.locator('#soundtrack-toggle').click();
  await expect(panel).toHaveCount(0);
});

test('with the animatic open, the soundtrack shows under its picture', async ({ page }) => {
  await open(page, '#tab=story');
  await page.locator('#animatic-toggle').click();
  const stage = page.locator('#animatic');
  await expect(stage).toBeVisible();
  // Soundtrack: the tracks right under the animatic picture, in the same view
  await page.locator('#soundtrack-toggle').click();
  const docked = stage.locator('#soundtrack');
  await expect(docked).toBeVisible();
  await expect(page.locator('#soundtrack')).toHaveCount(1);
  const picture = (await stage.locator('.frame').boundingBox())!;
  const tracks = (await docked.locator('.tracks').boundingBox())!;
  expect(tracks.y).toBeGreaterThan(picture.y + picture.height);
  await expect(docked.locator('.lane[data-track="music"]')).toBeVisible();
  // the playhead follows the player
  await page.locator('#play-toggle').click();
  await page.waitForTimeout(600);
  await page.locator('#play-toggle').click();
  const left = await docked
    .locator('.lane .playhead')
    .first()
    .evaluate((e) => e.style.left);
  expect(parseFloat(left)).toBeGreaterThan(0);
  // track controls work from there
  await docked.getByRole('button', { name: 'Solo track SFX' }).click();
  await expect(docked.getByRole('button', { name: 'Solo track SFX' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // the button hides it again; closing the animatic keeps it as a panel above the bar
  await page.locator('#soundtrack-toggle').click();
  await expect(page.locator('#soundtrack')).toHaveCount(0);
  await page.locator('#soundtrack-toggle').click();
  await page.locator('#animatic-toggle').click();
  await expect(stage).toHaveCount(0);
  await expect(page.locator('#soundtrack')).toBeVisible();
});

test('attach audio to a line from the script context menu', async ({ page }) => {
  await open(page, '#tab=story');
  const id = lineId('The lamp ROARS');
  await page.locator(`.cm-line[data-line-id="${id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Attach audio to line…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Attach audio to this line' });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-asset-id="match-strike"]').click();
  await expect(dialog).toBeHidden();
  const card = page.locator('article[data-annotation="lamp"]');
  await expect(card).toHaveAttribute('aria-current', 'true');
  await expect(card.locator('.cue-panel')).toBeVisible();
  await expect(status(page)).toHaveText('Saved');
  expect(cueOn(id)).toMatchObject({ asset: 'match-strike', track: 'sfx' });
});

test('assets: context menu uses an asset in the selected shot, renames, deletes', async ({
  page,
}) => {
  await open(page, '#tab=assets&shot=climb');
  const before = disk('shots/climb.json').variants.length;
  await page.locator('button[data-asset-id="maya"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Use in Shot 2/ }).click();
  await expect(status(page)).toHaveText('Saved');
  expect(disk('shots/climb.json').variants).toHaveLength(before + 1);
  // keyboard: Shift+F10 on an asset → Rename focuses its name field
  await page.locator('button[data-asset-id="matchbox"]').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await expect(page.locator('#asset-name-input')).toBeFocused();
  await page.locator('#asset-name-input').fill('Box of matches');
  await page.locator('#asset-name-input').press('Enter');
  await expect(status(page)).toHaveText('Saved');
  expect(disk('assets.json').assets.find((a: { id: string }) => a.id === 'matchbox').name).toBe(
    'Box of matches',
  );
  // Delete… asks first when the asset is used
  await page.locator('button[data-asset-id="lamp"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await expect(page.getByRole('alert')).toContainText('Used in');
});
