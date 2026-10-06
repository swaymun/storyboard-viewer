import { beforeAll, describe, expect, it } from 'vitest';
import {
  addAsset,
  addCue,
  addShot,
  addVariant,
  hashText,
  insertScriptLines,
  moveShot,
  removeAsset,
  removeCue,
  removeLines,
  removeShot,
  removeVariant,
  resolveLines,
  SbdEditError,
  setActiveVariant,
  setScript,
  setShotLines,
  updateAsset,
  updateCue,
  updateLine,
  updateShot,
  updateVariant,
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
const order = (p: SbdProject) => p.ids.shots.map((s) => s.id);
const lineId = (p: SbdProject, prefix: string) =>
  p.ids.lines.find((l) => l.text.startsWith(prefix))!.id;
const texts = (p: SbdProject, shot: string) => {
  const lines = resolveLines(p);
  return p.ids.shots.find((s) => s.id === shot)!.lines.map((id) => lines.get(id)!.text);
};

describe('shot ops', () => {
  it('adds shots at the end, after a shot, or at the start', () => {
    const a = addShot(base, { title: 'New' });
    expect(order(a.project).at(-1)).toBe(a.id);
    expect(a.id).toMatch(/^s_[0-9a-z]{6}$/);
    const b = addShot(base, { id: 'insert', after: 'opening' });
    expect(order(b.project)).toEqual(['opening', 'insert', 'climb', 'match', 'lamp']);
    const c = addShot(base, { id: 'first', after: null, fields: { camera: 'Wide' } });
    expect(order(c.project)[0]).toBe('first');
    expect(errors(c.project)).toEqual([]);
    expect(() => addShot(base, { id: 'opening' })).toThrow(/already exists/);
    expect(() => addShot(base, { id: 'bad id' })).toThrow(SbdEditError);
    // the original is untouched
    expect(order(base)).toEqual(['opening', 'climb', 'match', 'lamp']);
  });

  it('updates fields (merge, null deletes) and duration', () => {
    const p = updateShot(base, 'opening', {
      fields: { camera: 'Wide', notes: null, mood: 'eerie' },
      duration: 4,
      title: null,
    });
    const s = p.shots['opening']!;
    expect(s.fields).toEqual({
      camera: 'Wide',
      movement: 'Static',
      lens: '24mm',
      transition: 'Fade in',
      mood: 'eerie',
    });
    expect(s.duration).toBe(4);
    expect(s.title).toBeUndefined();
    expect(base.shots['opening']!.fields!['notes']).toBeDefined();
    expect(() => updateShot(base, 'opening', { duration: -1 })).toThrow(/duration/);
    expect(() => updateShot(base, 'nope', {})).toThrow(/Unknown shot/);
    expect(() => updateShot(base, 'opening', { id: 'x' })).toThrow(/cannot change/);
  });

  it('moves shots', () => {
    expect(order(moveShot(base, 'lamp', { index: 0 }))).toEqual([
      'lamp',
      'opening',
      'climb',
      'match',
    ]);
    expect(order(moveShot(base, 'opening', { after: 'match' }))).toEqual([
      'climb',
      'match',
      'opening',
      'lamp',
    ]);
    expect(order(moveShot(base, 'match', { after: null }))).toEqual([
      'match',
      'opening',
      'climb',
      'lamp',
    ]);
    expect(() => moveShot(base, 'match', {})).toThrow(/index/);
  });

  it('removes a shot and the cues targeting it', () => {
    const withCue = addCue(base, {
      id: 'shotcue',
      asset: 'music',
      target: { shot: 'climb' },
    }).project;
    const r = removeShot(withCue, 'climb');
    expect(order(r.project)).toEqual(['opening', 'match', 'lamp']);
    expect(r.removedCues).toEqual(['shotcue']);
    expect(r.project.shots['climb']).toBeUndefined();
    expect(errors(r.project)).toEqual([]);
  });

  it('sets lines exclusively (removing them from other shots) in script order', () => {
    const strike = lineId(base, 'She strikes');
    const roar = lineId(base, 'The lamp ROARS');
    const p = setShotLines(base, 'lamp', [lineId(base, 'Some things'), roar, strike]);
    expect(texts(p, 'lamp')).toEqual([
      'She strikes a match. The flame flickers.',
      'The lamp ROARS to life. Light sweeps across the sea.',
      'Some things are worth keeping.',
    ]);
    expect(texts(p, 'match')).not.toContain('She strikes a match. The flame flickers.');
    expect(() => setShotLines(base, 'lamp', ['l_nope'])).toThrow(/Unknown line/);
    const shared = setShotLines(base, 'lamp', [strike], { exclusive: false });
    expect(texts(shared, 'match')).toContain('She strikes a match. The flame flickers.');
  });
});

describe('variant ops', () => {
  it('adds, updates, activates and removes variants', () => {
    const a = addVariant(
      base,
      'match',
      { type: 'image', name: 'Alt', asset: 'lamp' },
      { activate: true },
    );
    expect(a.project.shots['match']!.active_variant).toBe(a.id);
    const c = addVariant(a.project, 'match', {
      type: 'canvas',
      layers: [{ id: 'l1', asset: 'maya', x: 10 }],
    });
    expect(c.project.shots['match']!.variants).toHaveLength(3);
    const u = updateVariant(c.project, 'match', c.id, { name: 'Comp' });
    expect(u.shots['match']!.variants!.find((v) => v.id === c.id)!.name).toBe('Comp');
    const s = setActiveVariant(u, 'match', 'closeup');
    expect(s.shots['match']!.active_variant).toBe('closeup');
    const r = removeVariant(s, 'match', 'closeup');
    expect(r.shots['match']!.active_variant).toBe(a.id);
    expect(errors(r)).toEqual([]);
    expect(() => addVariant(base, 'match', { type: 'image', asset: 'nope' })).toThrow(
      /Unknown asset/,
    );
    expect(() => setActiveVariant(base, 'match', 'nope')).toThrow(/no variant/);
  });
});

describe('asset ops', () => {
  it('adds, updates and removes assets', () => {
    const a = addAsset(base, {
      name: 'Clip',
      kind: 'video',
      src: 'file:../renders/clip.mp4',
      category: 'footage',
    });
    expect(a.id).toMatch(/^a_/);
    const u = updateAsset(a.project, a.id, { tags: ['x'], category: null as never });
    expect(u.assets.assets.at(-1)!.tags).toEqual(['x']);
    expect(u.assets.assets.at(-1)!.category).toBeUndefined();
    expect(() => addAsset(base, { name: 'x', kind: 'image', src: '../evil.png' })).toThrow(
      /Invalid src/,
    );
    expect(() => removeAsset(base, 'maya')).toThrow(/still used/);
    const forced = removeAsset(base, 'opening-color', { force: true });
    expect(forced.shots['opening']!.variants!.map((v) => v.id)).toEqual(['sketch']);
    expect(forced.shots['opening']!.active_variant).toBe('sketch');
    const noDialogue = removeAsset(base, 'dialogue', { force: true });
    expect(noDialogue.timeline.cues.map((c) => c.id)).toEqual(['strike', 'theme']);
    expect(errors(noDialogue)).toEqual([]);
  });
});

describe('cue ops', () => {
  it('adds, updates and removes cues with checks', () => {
    const a = addCue(base, {
      asset: 'dialogue',
      in: 1,
      out: 2,
      target: { range: [lineId(base, 'EXT.'), lineId(base, 'Waves')] },
      track: 'dialogue',
    });
    expect(a.id).toMatch(/^c_/);
    const u = updateCue(a.project, a.id, { gain: 0.5, offset: 0.2 });
    expect(u.timeline.cues.at(-1)).toMatchObject({ gain: 0.5, offset: 0.2 });
    expect(removeCue(u, a.id).timeline.cues).toHaveLength(base.timeline.cues.length);
    expect(() => addCue(base, { asset: 'maya', target: { shot: 'opening' } })).toThrow(
      /audio or video/,
    );
    expect(() => addCue(base, { asset: 'music', target: { line: 'l_nope' } })).toThrow(
      /Unknown line/,
    );
    expect(() =>
      addCue(base, { asset: 'music', in: 3, out: 2, target: { shot: 'opening' } }),
    ).toThrow(/greater/);
    expect(() =>
      addCue(base, { asset: 'music', target: { shot: 'opening', line: 'x' } as never }),
    ).toThrow(/exactly one/);
    expect(() => updateCue(base, 'nope', {})).toThrow(/Unknown cue/);
  });
});

describe('script ops', () => {
  it('inserts lines after a line, keeping all existing IDs, and attaches them to the shot', () => {
    const r = insertScriptLines(base, {
      text: 'MAYA\nIt is so quiet up here.',
      after_line: lineId(base, 'Maya, 30s'),
    });
    expect(r.added).toHaveLength(1);
    expect(r.removed).toEqual([]);
    const oldIds = new Set(base.ids.lines.map((l) => l.id));
    expect(r.project.ids.lines.filter((l) => oldIds.has(l.id))).toHaveLength(base.ids.lines.length);
    expect(texts(r.project, 'climb')).toEqual([
      'INT. LANTERN ROOM - NIGHT',
      'Maya, 30s, climbs the last step, out of breath. She holds a matchbox.',
      'It is so quiet up here.',
    ]);
    expect(r.project.script).toContain(
      'She holds a matchbox.\n\nMAYA\nIt is so quiet up here.\n\nMAYA\n(whispering)',
    );
    expect(r.project.ids.script_hash).toBe(hashText(r.project.script!));
    expect(errors(r.project)).toEqual([]);
  });

  it('inserts into an empty shot after the previous shots, and appends at the end', () => {
    const s = addShot(base, { id: 'cutaway', after: 'climb' });
    const r = insertScriptLines(s.project, { text: 'Gulls circle the tower.', shot: 'cutaway' });
    expect(texts(r.project, 'cutaway')).toEqual(['Gulls circle the tower.']);
    expect(r.project.script!.indexOf('Gulls')).toBeLessThan(
      r.project.script!.indexOf('(whispering)'),
    );
    const e = insertScriptLines(base, { text: 'THE END' });
    expect(e.project.script!.trimEnd().endsWith('THE END')).toBe(true);
    expect(e.added).toHaveLength(1);
    const empty = insertScriptLines(
      {
        ...base,
        script: null,
        ids: { lines: [], shots: base.ids.shots.map((x) => ({ ...x, lines: [] })) },
      },
      { text: 'INT. VOID - DAY', shot: 'opening' },
    );
    expect(texts(empty.project, 'opening')).toEqual(['INT. VOID - DAY']);
  });

  it('updates a line in place without changing its ID', () => {
    const id = lineId(base, 'Okay, Grandpa');
    const r = updateLine(base, id, 'Alright, Grandpa. Show me.');
    expect(r.added).toEqual([]);
    expect(resolveLines(r.project).get(id)!.text).toBe('Alright, Grandpa. Show me.');
    expect(r.project.ids.lines.map((l) => l.id)).toEqual(base.ids.lines.map((l) => l.id));
    expect(errors(r.project)).toEqual([]);
    expect(() => updateLine(base, id, 'a\nb')).toThrow(/single line/);
  });

  it('removes lines, their orphaned character cue and cues targeting them', () => {
    const id = lineId(base, 'Some things');
    const r = removeLines(base, [id]);
    expect(r.removed).toEqual([id]);
    expect(r.removedCues).toEqual(['vo-2']);
    expect(r.project.script).not.toContain('Some things');
    expect(r.project.script).not.toMatch(/MAYA \(V\.O\.\)\n\n> FADE OUT/);
    expect(r.project.ids.lines).toHaveLength(base.ids.lines.length - 1);
    expect(r.added).toEqual([]);
    expect(errors(r.project)).toEqual([]);
  });

  it('sets the whole script with re-anchoring', () => {
    const s = base.script!.replace('The lamp ROARS to life.', 'The lamp BLAZES to life.');
    const r = setScript(base, s);
    expect(r.added).toEqual([]);
    expect(texts(r.project, 'lamp')[0]).toBe(
      'The lamp BLAZES to life. Light sweeps across the sea.',
    );
    const none = setScript(base, null);
    expect(none.project.ids.lines).toEqual([]);
    expect(none.removedCues.sort()).toEqual(['maya-1', 'strike', 'vo-1', 'vo-2']);
    expect(errors(none.project)).toEqual([]);
  });
});
