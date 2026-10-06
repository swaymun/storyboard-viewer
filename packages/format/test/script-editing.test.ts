import { beforeAll, describe, expect, it } from 'vitest';
import {
  addShot,
  mergeProjects,
  moveLines,
  moveShotWithLines,
  parseFountain,
  placeLines,
  replaceScriptRange,
  resolveLines,
  updateLine,
  updateShot,
  validateProject,
  type SbdProject,
} from '../src/index.js';
import { openProjectPath } from '../src/node.js';
import { EXAMPLE } from './helpers.js';

let base: SbdProject;
beforeAll(async () => {
  base = (await openProjectPath(EXAMPLE)).project;
});

const errors = (p: SbdProject) => validateProject(p).filter((i) => i.severity === 'error');
const ref = (p: SbdProject, id: string) => p.ids.shots.find((s) => s.id === id)!;
const texts = (p: SbdProject, shot: string) => {
  const lines = resolveLines(p);
  return ref(p, shot).lines.map((id) => lines.get(id)!.text);
};
const idOf = (p: SbdProject, prefix: string) =>
  p.ids.lines.find((l) => l.text.startsWith(prefix))!.id;
/** Line IDs in script order with their text: a fingerprint of the mapping. */
const mapping = (p: SbdProject) => p.ids.lines.map((l) => `${l.id}=${l.text}`);

describe('replaceScriptRange (free-form typing)', () => {
  it('typing inside a line keeps every ID', () => {
    const at = base.script!.indexOf('the lamp is dark.') + 'the lamp is dark'.length;
    const r = replaceScriptRange(base, at, at, ', cold');
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    const id = idOf(base, 'Waves crash');
    expect(r.project.ids.lines.find((l) => l.id === id)!.text).toMatch(/dark, cold\.$/);
    expect(r.project.ids.lines.map((l) => l.id)).toEqual(base.ids.lines.map((l) => l.id));
    expect(errors(r.project)).toEqual([]);
  });

  it('a new line typed inside a shot joins that shot; types are inferred', () => {
    const anchor = base.script!.indexOf('She strikes a match.');
    const insert = 'MAYA\n(quietly)\nHere goes.\n\n';
    const r = replaceScriptRange(base, anchor, anchor, insert);
    expect(r.added).toHaveLength(2);
    const lines = resolveLines(r.project);
    expect(r.added.map((id) => lines.get(id)!.type)).toEqual(['parenthetical', 'dialogue']);
    expect(lines.get(r.added[1]!)!.element!.character).toBe('MAYA');
    const owner = r.project.ids.shots.find((s) => s.lines.includes(r.added[0]!))!;
    expect(owner.id).toBe('match');
    // untouched lines keep their IDs
    const before = new Set(base.ids.lines.map((l) => l.id));
    expect(r.project.ids.lines.filter((l) => before.has(l.id))).toHaveLength(before.size);
  });

  it('typing a scene heading prefix turns an action line into a scene heading, same ID', () => {
    const id = idOf(base, 'She strikes');
    const pos = base.script!.indexOf('She strikes a match.');
    const end = pos + 'She strikes a match. The flame flickers.'.length;
    const r = replaceScriptRange(base, pos, end, 'INT. STAIRS - NIGHT');
    const line = resolveLines(r.project).get(id);
    expect(line?.type).toBe('scene_heading');
  });

  it('deleting lines drops them from shots and removes their cues', () => {
    const pos = base.script!.indexOf('MAYA (V.O.)\nEvery night');
    const end = base.script!.indexOf('INT. LANTERN ROOM');
    const r = replaceScriptRange(base, pos, end, '');
    expect(r.removed).toEqual([idOf(base, 'Every night')]);
    expect(ref(r.project, 'opening').lines).not.toContain(idOf(base, 'Every night'));
    expect(r.removedCues.length).toBeGreaterThan(0);
    expect(errors(r.project)).toEqual([]);
  });

  it('works on a project without a script and rejects bad ranges', () => {
    const empty: SbdProject = { ...base, script: null, ids: { ...base.ids, lines: [], shots: [] } };
    const r = replaceScriptRange(empty, 0, 0, 'INT. ROOM - DAY\n\nA chair.\n');
    expect(r.project.ids.lines.map((l) => l.type)).toEqual(['scene_heading', 'action']);
    expect(() => replaceScriptRange(base, 5, 2, 'x')).toThrow(/range/i);
    expect(() => replaceScriptRange(base, 0, 1e9, 'x')).toThrow(/past the end/);
  });
});

describe('moveLines / moveShotWithLines', () => {
  it('moves a shot and its lines so script order follows shot order', () => {
    const p = moveShotWithLines(base, 'lamp', { index: 0 });
    expect(p.ids.shots.map((s) => s.id)).toEqual(['lamp', 'opening', 'climb', 'match']);
    // same IDs, same texts, new order
    expect(mapping(p).toSorted()).toEqual(mapping(base).toSorted());
    expect(texts(p, 'lamp')).toEqual(texts(base, 'lamp'));
    const firstLine = p.ids.lines[0]!;
    expect(ref(p, 'lamp').lines[0]).toBe(firstLine.id);
    // the V.O. cue came along
    const lines = resolveLines(p);
    expect(lines.get(ref(p, 'lamp').lines[1]!)!.element!.extension).toBe('V.O.');
    // script order == shot order
    const ordinals = p.ids.shots.flatMap((s) => s.lines.map((l) => lines.get(l)!.ordinal));
    expect(ordinals).toEqual(ordinals.toSorted((a, b) => a - b));
    expect(errors(p)).toEqual([]);
    // reparsing the script yields the same lines
    expect(parseFountain(p.script!).lines.map((l) => l.text)).toEqual(
      p.ids.lines.map((l) => l.text),
    );
  });

  it('moving a shot that is already in place changes only the order of lineless shots', () => {
    const withB = addShot(base, { id: 'broll', after: 'climb' }).project;
    const p = moveShotWithLines(withB, 'broll', { index: 0 });
    expect(p.script).toBe(withB.script);
    expect(p.ids.shots[0]!.id).toBe('broll');
  });

  it('splits a dialogue block and repeats the cue', () => {
    // move "Okay, Grandpa." (dialogue under MAYA + parenthetical) to the end
    const id = idOf(base, 'Okay, Grandpa');
    const p = moveLines(base, [id], { end: true });
    const line = resolveLines(p).get(id)!;
    expect(line.element!.character).toBe('MAYA');
    expect(line.type).toBe('dialogue');
    expect(mapping(p).toSorted()).toEqual(mapping(base).toSorted());
    // the parenthetical left behind still belongs to MAYA
    const paren = resolveLines(p).get(idOf(base, '(whispering'))!;
    expect(paren.element!.character).toBe('MAYA');
    expect(errors(p)).toEqual([]);
  });

  it('forces an all-caps action line that would read as a character cue', () => {
    const p0 = replaceScriptRange(
      base,
      base.script!.length,
      base.script!.length,
      '\nThe house is quiet.\nBANG!\nThe door slams.\n',
    ).project;
    const bang = idOf(p0, 'BANG!');
    const p = moveLines(p0, [bang, idOf(p0, 'The door slams')], {
      before: idOf(p0, 'Waves crash'),
    });
    expect(resolveLines(p).get(bang)!.type).toBe('action');
    expect(p.script).toContain('!BANG!');
  });

  it('rejects unknown lines and moving next to itself', () => {
    const id = idOf(base, 'Okay, Grandpa');
    expect(() => moveLines(base, ['nope'], { end: true })).toThrow(/Unknown line/);
    expect(() => moveLines(base, [id], { before: id })).toThrow(/themselves/);
  });
});

describe('mergeProjects: line-level script merge', () => {
  it('merges script edits in different places and keeps both sides’ IDs', () => {
    const a = idOf(base, 'Waves crash');
    const b = idOf(base, 'The lamp ROARS');
    const ours = updateLine(base, a, 'Waves crash. Ours.').project;
    const theirsEdit = updateLine(base, b, 'The lamp ROARS. Theirs.');
    const { project, conflicts } = mergeProjects(base, ours, theirsEdit.project);
    expect(conflicts).toEqual([]);
    const lines = resolveLines(project);
    expect(lines.get(a)!.text).toBe('Waves crash. Ours.');
    expect(lines.get(b)!.text).toBe('The lamp ROARS. Theirs.');
    expect(project.ids.lines.map((l) => l.id)).toEqual(base.ids.lines.map((l) => l.id));
    expect(errors(project)).toEqual([]);
  });

  it('keeps lines the agent added into a shot while the user typed elsewhere', () => {
    const a = idOf(base, 'Waves crash');
    const pos = base.script!.indexOf('She strikes');
    const theirs = replaceScriptRange(base, pos, pos, 'She hesitates.\n').project;
    const added = theirs.ids.lines.find((l) => l.text === 'She hesitates.')!.id;
    const ours = updateShot(updateLine(base, a, 'Typed by the user.').project, 'match', {
      title: 'Mine',
    });
    const { project, conflicts } = mergeProjects(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(project.ids.lines.some((l) => l.id === added)).toBe(true);
    expect(ref(project, 'match').lines).toContain(added);
    expect(project.shots['match']!.title).toBe('Mine');
  });

  it('same line changed on both sides: ours wins and it is reported', () => {
    const a = idOf(base, 'Waves crash');
    const ours = updateLine(base, a, 'Ours.').project;
    const theirs = updateLine(base, a, 'Theirs.').project;
    const r = mergeProjects(base, ours, theirs);
    expect(r.conflicts).toEqual(['script.fountain']);
    expect(r.project.script).toBe(ours.script);
  });
});

describe('placeLines', () => {
  it('moves a line into another shot and next to its lines', () => {
    const id = idOf(base, 'Waves crash');
    const p = placeLines(base, [id], 'lamp');
    expect(ref(p, 'lamp').lines.at(-1)).toBe(id);
    expect(ref(p, 'opening').lines).not.toContain(id);
    const lines = resolveLines(p);
    const ordinals = p.ids.shots.flatMap((s) => s.lines.map((l) => lines.get(l)!.ordinal));
    expect(ordinals).toEqual(ordinals.toSorted((a, b) => a - b));
    expect(mapping(p).toSorted()).toEqual(mapping(base).toSorted());
    expect(errors(p)).toEqual([]);
  });

  it('reorders a line within its shot (before another line)', () => {
    const a = idOf(base, 'The lamp ROARS');
    const b = ref(base, 'lamp').lines.at(-1)!; // FADE OUT.
    const p = placeLines(base, [b], 'lamp', { before: a });
    expect(texts(p, 'lamp')[0]).toBe('FADE OUT.');
    expect(() => placeLines(base, [b], 'lamp', { before: idOf(base, 'Waves') })).toThrow(
      /not in shot/,
    );
  });
});
