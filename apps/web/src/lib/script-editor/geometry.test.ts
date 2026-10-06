import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addShot,
  parseFountain,
  replaceScriptRange,
  type SbdProject,
} from '@storyboard-viewer/format';
import { openProjectPath } from '@storyboard-viewer/format/node';
import { adjustBoundary, addLinelessShot, makeShot, makeShotFromSpan } from './actions';
import { lineTypes } from './fountain-highlight';
import { computeAnnotations, linesInRange, nudgeBoundary, shotsAt } from './geometry';

const EXAMPLE = join(import.meta.dirname, '../../../../../examples/minimal.sbd');
let base: SbdProject;
beforeAll(async () => {
  base = (await openProjectPath(EXAMPLE)).project;
});
const ref = (p: SbdProject, id: string) => p.ids.shots.find((s) => s.id === id)!;
const idOf = (p: SbdProject, prefix: string) =>
  p.ids.lines.find((l) => l.text.startsWith(prefix))!.id;

describe('computeAnnotations', () => {
  it('maps every line to its position and every shot to the pieces of text it covers', () => {
    const a = computeAnnotations(base);
    const script = base.script!;
    expect(a.lines).toHaveLength(base.ids.lines.length);
    for (const l of a.lines) {
      const text = base.ids.lines.find((x) => x.id === l.id)!.text;
      expect(script.slice(l.pos)).toContain(text.slice(0, 5));
    }
    const opening = a.shots.find((s) => s.id === 'opening')!;
    expect(opening.pieces.map((x) => script.slice(x.from, x.to))).toEqual([
      'EXT. LIGHTHOUSE - DUSK',
      'Waves crash against black rocks. At the top of the tower, the lamp is dark.',
      'Every night for forty years, my grandfather lit the lamp.',
    ]);
    expect(opening.partial).toBe(false);
    const match = a.shots.find((s) => s.id === 'match')!;
    expect(script.slice(match.pieces[0]!.from).startsWith('(whispering)')).toBe(true);
  });

  it('a shot on part of a line covers exactly those words', () => {
    const line = idOf(base, 'Waves crash');
    const r = makeShotFromSpan(base, { line, offset: 20 }, { line, offset: 32 });
    const a = computeAnnotations(r.project);
    const s = a.shots.find((x) => x.id === r.id)!;
    expect(s.partial).toBe(true);
    expect(s.pieces.map((x) => base.script!.slice(x.from, x.to))).toEqual(['black rocks.']);
    expect(shotsAt(a, s.pieces[0]!.from + 2)).toEqual([r.id]);
    // in script order, after "opening"
    expect(r.project.ids.shots.map((x) => x.id).indexOf(r.id)).toBe(1);
  });

  it('places shots without lines after the previous shot, dims filtered shots', () => {
    const p = addShot(base, { id: 'broll', after: 'climb' }).project;
    const a = computeAnnotations(p, (id) => id !== 'lamp');
    const b = a.shots.find((s) => s.id === 'broll')!;
    expect(b.pieces).toEqual([]);
    expect(b.marker!.side).toBe(1);
    expect(p.script!.slice(0, b.marker!.pos)).toMatch(/She holds a matchbox\.$/);
    expect(a.shots.find((s) => s.id === 'lamp')!.dim).toBe(true);
    const first = addShot(base, { id: 'title', index: 0 }).project;
    expect(computeAnnotations(first).shots[0]!.marker).toEqual({ pos: 0, side: -1 });
  });

  it('linesInRange returns the lines starting in a range', () => {
    const a = computeAnnotations(base);
    const climb = a.shots.find((s) => s.id === 'climb')!;
    const lineStart = (pos: number) => base.script!.lastIndexOf('\n', pos - 1) + 1;
    expect(linesInRange(a, lineStart(climb.pieces[0]!.from), climb.pieces.at(-1)!.from)).toEqual(
      ref(base, 'climb').lines,
    );
  });
});

describe('shot actions', () => {
  it('makeShot takes lines out of their shot and puts the new shot in script order', () => {
    const id = idOf(base, 'She strikes');
    const r = makeShot(base, [id]);
    const order = r.project.ids.shots.map((s) => s.id);
    expect(order.indexOf(r.id)).toBe(order.indexOf('match') + 1);
    expect(ref(r.project, 'match').lines).not.toContain(id);
    expect(ref(r.project, r.id).lines).toEqual([id]);
    expect(() => makeShot(base, [])).toThrow(/Select/);
  });

  it('addLinelessShot goes after the shot under the cursor', () => {
    const ord = base.ids.lines.find((l) => l.id === idOf(base, 'Maya, 30s'))!.ordinal;
    const r = addLinelessShot(base, ord);
    expect(r.project.ids.shots.map((s) => s.id).indexOf(r.id)).toBe(2);
    expect(addLinelessShot(base, null).project.ids.shots[0]!.lines).toEqual([]);
  });

  it('adjustBoundary grows into the neighbour and shrinks to unassigned', () => {
    const grown = adjustBoundary(base, 'climb', 'end', 1);
    expect(ref(grown, 'climb').lines).toContain(ref(base, 'match').lines[0]);
    expect(ref(grown, 'match').lines).not.toContain(ref(base, 'match').lines[0]);
    const shrunk = adjustBoundary(base, 'opening', 'start', 1);
    expect(ref(shrunk, 'opening').lines).toEqual(ref(base, 'opening').lines.slice(1));
    // never below one line
    const one = adjustBoundary(adjustBoundary(base, 'climb', 'start', 1), 'climb', 'start', 1);
    expect(ref(one, 'climb').lines).toHaveLength(1);
  });

  it('typing keeps annotation geometry consistent (IDs of untouched lines stay)', () => {
    const pos = base.script!.indexOf('Waves crash');
    const r = replaceScriptRange(base, pos, pos, 'Thunder. ');
    const a = computeAnnotations(r.project);
    expect(a.lines.map((l) => l.id)).toEqual(base.ids.lines.map((l) => l.id));
  });
});

describe('lineTypes (live screenplay formatting)', () => {
  it('infers element types per physical line', () => {
    const t = lineTypes(
      parseFountain('INT. ROOM - DAY\n\nA chair.\n\nBOB (V.O.)\n(softly)\nHi.\n\n> CUT TO:\n'),
    );
    expect(t.slice(0, 9)).toEqual([
      'scene_heading',
      null,
      'action',
      null,
      'character vo',
      'parenthetical vo',
      'dialogue vo',
      null,
      'transition',
    ]);
  });
});

describe('nudgeBoundary', () => {
  const t = 'I was running from the cops, the cars.';
  it('moves a start by whole words', () => {
    const cops = t.indexOf('cops');
    expect(nudgeBoundary(t, cops, 'start', -1)).toBe(t.indexOf('the cops'));
    expect(nudgeBoundary(t, cops, 'start', 1)).toBe(t.indexOf('the cars'));
    expect(nudgeBoundary(t, 0, 'start', -1)).toBe(0);
  });
  it('moves an end by whole words', () => {
    const end = t.indexOf('cops') + 4;
    expect(nudgeBoundary(t, end, 'end', 1)).toBe(t.indexOf(' cars'));
    expect(nudgeBoundary(t, end, 'end', -1)).toBe(t.indexOf(' cops'));
    expect(nudgeBoundary(t, t.length, 'end', 1)).toBe(t.length);
  });
  it('moves by one character with exact', () => {
    expect(nudgeBoundary(t, 5, 'end', 1, true)).toBe(6);
    expect(nudgeBoundary(t, 0, 'start', -1, true)).toBe(0);
  });
});
