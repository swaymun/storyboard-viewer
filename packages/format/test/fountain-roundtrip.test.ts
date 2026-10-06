/**
 * Fountain round trips: import → export → import keeps lines, line IDs and shot mapping, also
 * when another Fountain app reformats the script in between.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  composeFountain,
  createProject,
  exportFountain,
  insertScriptLines,
  parseFountain,
  projectFromFountain,
  setScript,
  type ComposeInput,
  type SbdProject,
} from '../src/index.js';
import { openProjectPath } from '../src/node.js';
import { EXAMPLE } from './helpers.js';

const SAMPLE = readFileSync(join(import.meta.dirname, 'fixtures/sample.fountain'), 'utf8');
const NOW = new Date('2026-10-06T00:00:00Z');

/** Lines as comparable records (no IDs). */
const lineShape = (p: SbdProject) => p.ids.lines.map((l) => ({ text: l.text, type: l.type }));
/** Shot → line ordinals (ID independent). */
const shotShape = (p: SbdProject) => {
  const ord = new Map(p.ids.lines.map((l) => [l.id, l.ordinal]));
  return p.ids.shots.map((s) => s.lines.map((id) => ord.get(id)));
};
/** Shot → line IDs. */
const shotLines = (p: SbdProject) => p.ids.shots.map((s) => ({ id: s.id, lines: s.lines }));
const ids = (p: SbdProject) => p.ids.lines.map((l) => l.id);

describe('Fountain round trip', () => {
  let imported: SbdProject;
  beforeAll(() => {
    imported = projectFromFountain(SAMPLE, { now: NOW });
  });

  it('exports exactly the script that was imported', () => {
    expect(exportFountain(imported)).toBe(SAMPLE);
  });

  it('re-importing the export gives the same lines and shot split', () => {
    const again = projectFromFountain(exportFountain(imported), { now: NOW });
    expect(lineShape(again)).toEqual(lineShape(imported));
    expect(shotShape(again)).toEqual(shotShape(imported));
    expect(again.manifest.title).toBe(imported.manifest.title);
  });

  it('setting the exported script back is a no-op', () => {
    const r = setScript(imported, exportFountain(imported));
    expect(r.project).toBe(imported);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('keeps every line ID when another app reformats the script', () => {
    const reformatted = exportFountain(imported)
      .replace(/\n/g, '\r\n') // Windows line endings
      .replace(/(\S)\r\n/g, '$1  \r\n') // trailing spaces
      .replace(/\r\n\r\n/g, '\r\n\r\n\r\n') // extra blank lines between paragraphs
      .replace('Draft date: 2026-10-06', 'Draft date: 2026-12-24'); // title page edit
    const r = setScript(imported, reformatted);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(ids(r.project)).toEqual(ids(imported));
    expect(shotLines(r.project)).toEqual(shotLines(imported));
  });

  it('keeps IDs of edited lines and places new lines into their shot', () => {
    const exported = exportFountain(imported);
    const target = imported.ids.lines.find((l) => l.text.startsWith('Wind whips the grass'))!;
    const edited = exported
      .replace('Wind whips the grass flat.', 'Wind whips the tall grass flat.')
      .replace(
        'Its headlights catch the LIGHTHOUSE, dark against a bruised sky.',
        'Its headlights catch the LIGHTHOUSE, dark against a bruised sky.\nA gull screams overhead.',
      );
    const r = setScript(imported, edited);
    expect(r.removed).toEqual([]);
    expect(r.added).toHaveLength(1);
    const after = r.project.ids.lines.find((l) => l.id === target.id)!;
    expect(after.text).toMatch(/^Wind whips the tall grass flat\./);
    const shot = r.project.ids.shots.find((s) => s.lines.includes(target.id))!;
    expect(shot.lines).toContain(r.added[0]);
  });

  it('round-trips the example project through plain Fountain', async () => {
    const example = (await openProjectPath(EXAMPLE)).project;
    const text = exportFountain(example);
    expect(text).toBe(example.script);
    // Back into the same project: nothing changes.
    expect(setScript(example, text).project).toBe(example);
    // Into a new project: same lines in the same order.
    const fresh = projectFromFountain(text, { split: 'none', now: NOW });
    expect(lineShape(fresh)).toEqual(lineShape(example));
    expect(fresh.ids.shots).toEqual([]);
  });

  it('exports a title page for projects without a script, and re-imports it', () => {
    const p = createProject({ title: 'Launch Teaser', preset: 'motion', now: NOW });
    const text = exportFountain(p);
    expect(text).toBe('Title: Launch Teaser\n\n');
    const back = projectFromFountain(text, { now: NOW });
    expect(back.manifest.title).toBe('Launch Teaser');
    expect(back.ids.lines).toEqual([]);
  });

  it('lines written by the app composer survive export + parse with their types', () => {
    const inputs: ComposeInput[] = [
      { type: 'scene_heading', text: 'INT. GARAGE - NIGHT' },
      { type: 'scene_heading', text: 'Rooftop at dawn' },
      { type: 'action', text: 'BANG. The door slams.' },
      { type: 'action', text: 'MAYA' },
      { type: 'dialogue', character: 'Maya', extension: 'V.O.', text: 'We are late.' },
      { type: 'parenthetical', character: 'leo', text: 'whispering' },
      { type: 'transition', text: 'CUT TO:' },
      { type: 'transition', text: 'Smash cut' },
      { type: 'centered', text: 'THE END' },
    ];
    let p = createProject({ title: 'Composer', now: NOW });
    for (const input of inputs) p = insertScriptLines(p, { text: composeFountain(input) }).project;
    const reparsed = parseFountain(exportFountain(p)).lines.map((l) => l.type);
    expect(reparsed).toEqual(p.ids.lines.map((l) => l.type));
    expect(reparsed).toEqual([
      'scene_heading',
      'scene_heading',
      'action',
      'action',
      'dialogue',
      'parenthetical',
      'transition',
      'transition',
      'centered',
    ]);
    // And a second round trip keeps every ID.
    expect(ids(setScript(p, exportFountain(p).replace(/\n/g, '\r\n')).project)).toEqual(ids(p));
  });
});
