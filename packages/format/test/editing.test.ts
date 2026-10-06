import { beforeAll, describe, expect, it } from 'vitest';
import {
  addCue,
  addLayer,
  addShot,
  composeFountain,
  deepEqual,
  diffProjectFiles,
  duplicateLayer,
  duplicateShot,
  insertScriptLines,
  mergeProjects,
  mergeShots,
  moveLayer,
  moveShot,
  moveVariant,
  parseFountain,
  removeLayer,
  removeShot,
  resolveLines,
  serializeProject,
  splitShot,
  updateLayer,
  updateLine,
  updateShot,
  updateTrack,
  validateProject,
  type CanvasVariant,
  type SbdProject,
} from '../src/index.js';
import { openProjectPath } from '../src/node.js';
import { EXAMPLE } from './helpers.js';

let base: SbdProject;
beforeAll(async () => {
  base = (await openProjectPath(EXAMPLE)).project;
});

const errors = (p: SbdProject) => validateProject(p).filter((i) => i.severity === 'error');
const order = (p: SbdProject) => p.ids.shots.map((s) => s.id);
const ref = (p: SbdProject, id: string) => p.ids.shots.find((s) => s.id === id)!;
const canvas = (p: SbdProject) =>
  p.shots['climb']!.variants!.find((v) => v.type === 'canvas') as CanvasVariant;

describe('shot structure ops', () => {
  it('splits a shot at a line', () => {
    const lines = ref(base, 'match').lines;
    const { project, id } = splitShot(base, 'match', lines[1]!, { title: 'Second half' });
    expect(order(project)).toEqual(['opening', 'climb', 'match', id, 'lamp']);
    expect(ref(project, 'match').lines).toEqual([lines[0]]);
    expect(ref(project, id).lines).toEqual(lines.slice(1));
    expect(project.shots[id]!.title).toBe('Second half');
    expect(project.shots[id]!.fields).toEqual(base.shots['match']!.fields);
    expect(errors(project)).toEqual([]);
    expect(() => splitShot(base, 'match', lines[0]!)).toThrow(/after the first/);
    expect(() => splitShot(base, 'match', ref(base, 'lamp').lines[0]!)).toThrow(/not in shot/);
  });

  it('merges a shot into the previous one and retargets its cues', () => {
    const withCue = addCue(base, {
      asset: 'match-strike',
      target: { shot: 'lamp' },
      track: 'sfx',
    }).project;
    const p = mergeShots(withCue, 'match', 'lamp');
    expect(order(p)).toEqual(['opening', 'climb', 'match']);
    expect(ref(p, 'match').lines).toEqual([
      ...ref(base, 'match').lines,
      ...ref(base, 'lamp').lines,
    ]);
    expect(p.shots['lamp']).toBeUndefined();
    const ids = p.shots['match']!.variants!.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(
      base.shots['match']!.variants!.length + base.shots['lamp']!.variants!.length,
    );
    expect(p.timeline.cues.some((c) => 'shot' in c.target && c.target.shot === 'lamp')).toBe(false);
    expect(errors(p)).toEqual([]);
  });

  it('duplicates a shot without its lines', () => {
    const { project, id } = duplicateShot(base, 'opening');
    expect(order(project).slice(0, 2)).toEqual(['opening', id]);
    expect(ref(project, id).lines).toEqual([]);
    expect(project.shots[id]!.variants).toEqual(base.shots['opening']!.variants);
    expect(errors(project)).toEqual([]);
  });

  it('reorders variants', () => {
    const vs = base.shots['opening']!.variants!.map((v) => v.id);
    const p = moveVariant(base, 'opening', vs[1]!, 0);
    expect(p.shots['opening']!.variants!.map((v) => v.id)).toEqual([vs[1], vs[0]]);
  });
});

describe('layer ops', () => {
  it('adds, updates, reorders, duplicates and removes layers', () => {
    const v = canvas(base);
    const added = addLayer(base, 'climb', v.id, { asset: 'matchbox', x: 10, y: 20 });
    let p = added.project;
    expect(canvas(p).layers.at(-1)!.id).toBe(added.id);
    p = updateLayer(p, 'climb', v.id, added.id, {
      x: 99,
      rotation: 15,
      crop: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(canvas(p).layers.at(-1)).toMatchObject({ x: 99, y: 20, rotation: 15 });
    p = updateLayer(p, 'climb', v.id, added.id, { crop: null });
    expect(canvas(p).layers.at(-1)!.crop).toBeUndefined();
    p = moveLayer(p, 'climb', v.id, added.id, 0);
    expect(canvas(p).layers[0]!.id).toBe(added.id);
    const dup = duplicateLayer(p, 'climb', v.id, added.id);
    expect(canvas(dup.project).layers[1]).toMatchObject({ id: dup.id, x: 123, y: 44 });
    p = removeLayer(dup.project, 'climb', v.id, added.id);
    expect(canvas(p).layers.some((l) => l.id === added.id)).toBe(false);
    expect(errors(p)).toEqual([]);
    expect(() => updateLayer(base, 'climb', v.id, 'nope', { x: 1 })).toThrow(/Unknown layer/);
    expect(() => addLayer(base, 'climb', v.id, { asset: 'nope' })).toThrow(/Unknown asset/);
  });

  it('creates and patches tracks', () => {
    let p = updateTrack(base, 'music', { gain: 0.5, muted: true });
    expect(p.timeline.tracks!.find((t) => t.id === 'music')).toMatchObject({
      gain: 0.5,
      muted: true,
    });
    p = updateTrack(p, 'music', { muted: null });
    expect(p.timeline.tracks!.find((t) => t.id === 'music')!.muted).toBeUndefined();
    p = updateTrack(p, 'ambience', { label: 'Ambience' });
    expect(p.timeline.tracks!.at(-1)).toEqual({ id: 'ambience', label: 'Ambience' });
    expect(() => updateTrack(base, 'music', { gain: -1 })).toThrow(/gain/);
  });
});

describe('composeFountain', () => {
  const typeOf = (text: string) => parseFountain(`${text}\n`).lines.map((l) => l.type);
  it('produces each element type', () => {
    expect(typeOf(composeFountain({ type: 'scene_heading', text: 'INT. HOUSE - DAY' }))).toEqual([
      'scene_heading',
    ]);
    expect(composeFountain({ type: 'scene_heading', text: 'The roof' })).toBe('.The roof');
    expect(composeFountain({ type: 'action', text: 'She waits.' })).toBe('She waits.');
    // an all-caps line would read as a transition/character: forced
    expect(typeOf(composeFountain({ type: 'action', text: 'BANG TO:' }))).toEqual(['action']);
    expect(composeFountain({ type: 'transition', text: 'CUT TO:' })).toBe('CUT TO:');
    expect(composeFountain({ type: 'transition', text: 'Fade out' })).toBe('> Fade out');
    const d = composeFountain({
      type: 'dialogue',
      character: 'maya',
      extension: 'v.o.',
      parenthetical: '(quietly)',
      text: 'Hello.',
    });
    expect(d).toBe('MAYA (V.O.)\n(quietly)\nHello.');
    const parsed = parseFountain(`${d}\n`).lines;
    expect(parsed.map((l) => l.type)).toEqual(['parenthetical', 'dialogue']);
    expect(parsed[1]!.extension).toBe('V.O.');
    expect(() => composeFountain({ type: 'dialogue', text: 'x' })).toThrow(/Character/);
  });

  it('inserts composed lines after a selected line and keeps every other ID', () => {
    const after = ref(base, 'climb').lines[0]!;
    const text = composeFountain({ type: 'dialogue', character: 'Maya', text: 'Here goes.' });
    const res = insertScriptLines(base, { text, after_line: after });
    expect(res.added).toHaveLength(1);
    expect(ref(res.project, 'climb').lines).toContain(res.added[0]);
    const before = new Set(base.ids.lines.map((l) => l.id));
    expect(res.project.ids.lines.filter((l) => before.has(l.id))).toHaveLength(before.size);
    expect(resolveLines(res.project).get(res.added[0]!)!.element!.character).toBe('MAYA');
  });
});

describe('mergeProjects', () => {
  it('takes non-overlapping changes from both sides', () => {
    const ours = updateShot(moveShot(base, 'lamp', { index: 0 }), 'climb', { title: 'Ours' });
    const theirs = addShot(updateShot(base, 'match', { title: 'Theirs' }), {
      id: 'agent',
      after: 'climb',
    }).project;
    const { project, conflicts } = mergeProjects(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(order(project)).toEqual(['lamp', 'opening', 'climb', 'agent', 'match']);
    expect(project.shots['climb']!.title).toBe('Ours');
    expect(project.shots['match']!.title).toBe('Theirs');
    expect(project.shots['agent']).toBeDefined();
    expect(errors(project)).toEqual([]);
  });

  it('keeps ours on conflicts and reports them', () => {
    const ours = updateShot(base, 'climb', { title: 'Ours' });
    const theirs = updateShot(base, 'climb', { title: 'Theirs', fields: { notes: 'agent' } });
    const { project, conflicts } = mergeProjects(base, ours, theirs);
    expect(project.shots['climb']!.title).toBe('Ours');
    expect(project.shots['climb']!.fields!['notes']).toBe('agent');
    expect(conflicts).toEqual(['shots.climb.title']);
  });

  it('merges a script edit on one side with structural edits on the other', () => {
    const line = ref(base, 'opening').lines[1]!;
    const ours = updateLine(base, line, 'Waves crash. The lamp is dark.').project;
    const theirs = removeShot(base, 'lamp').project;
    const { project, conflicts } = mergeProjects(base, ours, theirs);
    expect(conflicts).toEqual([]);
    expect(project.script).toBe(ours.script);
    expect(order(project)).toEqual(['opening', 'climb', 'match']);
    expect(project.ids.lines.find((l) => l.id === line)!.text).toBe(
      'Waves crash. The lamp is dark.',
    );
    // the same line edited on both sides: ours wins (edits elsewhere merge line by line, see
    // script-editing.test.ts)
    const theirs2 = updateLine(base, line, 'Different.').project;
    const r2 = mergeProjects(base, ours, theirs2);
    expect(r2.conflicts).toEqual(['script.fountain']);
    expect(r2.project.script).toBe(ours.script);
  });

  it('drops shot files removed on the other side', () => {
    const ours = updateShot(base, 'lamp', { title: 'Edited' });
    const theirs = removeShot(base, 'lamp').project;
    const { project, conflicts } = mergeProjects(base, ours, theirs);
    expect(order(project)).not.toContain('lamp');
    expect(project.shots['lamp']).toBeUndefined();
    expect(conflicts.length).toBe(1);
  });

  it('is the identity when nothing changed remotely', () => {
    const ours = updateShot(base, 'climb', { title: 'X' });
    const { project, conflicts } = mergeProjects(base, ours, base);
    expect(conflicts).toEqual([]);
    expect(deepEqual(serializeProject(project), serializeProject(ours))).toBe(true);
  });
});

describe('diffProjectFiles', () => {
  it('lists changed and deleted text files', () => {
    const p = removeShot(updateShot(base, 'climb', { title: 'X' }), 'lamp').project;
    const diff = diffProjectFiles(base, p);
    expect(Object.keys(diff).sort()).toEqual(['ids.json', 'shots/climb.json', 'shots/lamp.json']);
    expect(diff['shots/lamp.json']).toBeNull();
    expect(diffProjectFiles(base, base)).toEqual({});
  });
});
