import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assignLineIds,
  hashLine,
  levenshtein,
  parseFountain,
  reanchorLines,
  reanchorScript,
  remapLineRefs,
  type LineIdEntry,
  type ReanchorOptions,
  type ReanchorResult,
} from '../src/index.js';

const sample = readFileSync(new URL('./fixtures/sample.fountain', import.meta.url), 'utf8');

/** Deterministic ID generator: p1, p2, … */
function seq(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function initial(texts: string[]): LineIdEntry[] {
  return reanchorLines(
    [],
    texts.map((text) => ({ text })),
    { newId: seq('o') },
  ).entries;
}

function run(old: LineIdEntry[], texts: string[], opts: ReanchorOptions = {}): ReanchorResult {
  return reanchorLines(
    old,
    texts.map((text) => ({ text })),
    { newId: seq('n'), ...opts },
  );
}

const ids = (r: ReanchorResult) => r.entries.map((e) => e.id);

const BASE = [
  'EXT. CLIFFSIDE ROAD - DUSK',
  'Wind whips the grass flat.',
  'A battered hatchback crawls up the road.',
  'My father kept the light burning for forty years.',
  'He said the sea never forgives a dark night.',
  'INT. LIGHTHOUSE - KITCHEN - NIGHT',
  'Dust. Mara sets a box on the table.',
  'Okay. Okay.',
  'Just one night.',
];

describe('reanchorLines', () => {
  const old = initial(BASE);

  it('keeps every id for an unchanged script', () => {
    const r = run(old, BASE);
    expect(ids(r)).toEqual(old.map((e) => e.id));
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.matches.every((m) => m.kind === 'exact')).toBe(true);
  });

  it('writes ordinal, hash and text for each entry', () => {
    const r = run(old, BASE);
    r.entries.forEach((e, i) => {
      expect(e.ordinal).toBe(i);
      expect(e.text).toBe(BASE[i]);
      expect(e.hash).toBe(hashLine(BASE[i]!));
      expect(e.hash).toMatch(/^[0-9a-f]{14}$/);
    });
  });

  it('handles insertions at start, middle and end', () => {
    const next = [
      'FADE IN:',
      ...BASE.slice(0, 3),
      'Gulls scream overhead.',
      ...BASE.slice(3),
      'FADE OUT.',
    ];
    const r = run(old, next);
    expect(ids(r)).toEqual([
      'n1',
      'o1',
      'o2',
      'o3',
      'n2',
      'o4',
      'o5',
      'o6',
      'o7',
      'o8',
      'o9',
      'n3',
    ]);
    expect(r.added).toEqual(['n1', 'n2', 'n3']);
    expect(r.removed).toEqual([]);
  });

  it('handles deletions', () => {
    const next = BASE.filter((_, i) => i !== 0 && i !== 4 && i !== 8);
    const r = run(old, next);
    expect(ids(r)).toEqual(['o2', 'o3', 'o4', 'o6', 'o7', 'o8']);
    expect(r.removed.map((e) => e.id)).toEqual(['o1', 'o5', 'o9']);
    expect(r.added).toEqual([]);
  });

  it('keeps ids when blocks are reordered', () => {
    // Swap the two scenes.
    const next = [...BASE.slice(5), ...BASE.slice(0, 5)];
    const r = run(old, next);
    expect(ids(r)).toEqual(['o6', 'o7', 'o8', 'o9', 'o1', 'o2', 'o3', 'o4', 'o5']);
    expect(r.added).toEqual([]);
    expect(new Set(r.matches.map((m) => m.kind))).toEqual(new Set(['exact', 'moved']));
  });

  it('matches small edits by similarity', () => {
    const next = [...BASE];
    next[1] = 'Wind whips the tall grass flat.';
    next[3] = 'My father kept that light burning for forty years.';
    next[7] = 'Okay. Okay. Okay.';
    const r = run(old, next);
    expect(ids(r)).toEqual(old.map((e) => e.id));
    const similar = r.matches.filter((m) => m.kind === 'similar');
    expect(similar.map((m) => m.id)).toEqual(['o2', 'o4', 'o8']);
    for (const m of similar) expect(m.score).toBeGreaterThan(0.5);
    expect(r.entries[1]!.text).toBe('Wind whips the tall grass flat.');
    expect(r.entries[1]!.hash).toBe(hashLine('Wind whips the tall grass flat.'));
  });

  it('ignores whitespace-only changes (exact match after normalization)', () => {
    const next = BASE.map((t) => `  ${t.replace(/ /g, '  ')} `);
    const r = run(old, next);
    expect(ids(r)).toEqual(old.map((e) => e.id));
    expect(r.matches.every((m) => m.kind === 'exact')).toBe(true);
  });

  it('matches a line that was both edited and moved far away', () => {
    const next = [
      'He said the sea never forgives a dark, dark night.',
      ...BASE.filter((_, i) => i !== 4),
    ];
    const r = run(old, next);
    expect(r.entries[0]!.id).toBe('o5');
    expect(r.matches.find((m) => m.id === 'o5')!.kind).toBe('similar');
    expect(r.added).toEqual([]);
  });

  it('gives a rewritten line a new id', () => {
    const next = [...BASE];
    next[6] = 'Silence. Then a kettle starts to whistle somewhere.';
    const r = run(old, next);
    expect(r.entries[6]!.id).toBe('n1');
    expect(r.removed.map((e) => e.id)).toEqual(['o7']);
  });

  it('does not pair unrelated short lines', () => {
    const o = initial(['INT. ROOM - DAY', 'Yes.', 'He leaves.']);
    const r = run(o, ['INT. ROOM - DAY', 'No.', 'He leaves.']);
    expect(ids(r)).toEqual(['o1', 'n1', 'o3']);
  });

  describe('duplicate lines', () => {
    const dup = ['Beat.', 'He looks up.', 'Beat.', 'She looks away.', 'Beat.'];
    const o = initial(dup);

    it('removes the right duplicate', () => {
      const r = run(o, ['Beat.', 'He looks up.', 'She looks away.', 'Beat.']);
      expect(ids(r)).toEqual(['o1', 'o2', 'o4', 'o5']);
      expect(r.removed.map((e) => e.id)).toEqual(['o3']);
    });

    it('mints a new id for an inserted duplicate', () => {
      const r = run(o, ['Beat.', 'Beat.', 'He looks up.', 'Beat.', 'She looks away.', 'Beat.']);
      expect(new Set(ids(r)).size).toBe(6);
      expect(r.added).toHaveLength(1);
      expect(r.removed).toEqual([]);
    });

    it('never reuses an id twice', () => {
      const r = run(o, ['Beat.', 'Beat.', 'Beat.', 'Beat.', 'Beat.', 'Beat.']);
      expect(new Set(ids(r)).size).toBe(6);
      expect(ids(r).filter((id) => id.startsWith('o'))).toEqual(['o1', 'o3', 'o5']);
    });

    it('handles reordering between duplicates', () => {
      const r = run(o, ['Beat.', 'She looks away.', 'Beat.', 'He looks up.', 'Beat.']);
      expect(new Set(ids(r))).toEqual(new Set(['o1', 'o2', 'o3', 'o4', 'o5']));
      expect(r.entries[1]!.id).toBe('o4');
      expect(r.entries[3]!.id).toBe('o2');
    });
  });

  it('matches exact text regardless of element type, penalizes type change for similar', () => {
    const o = reanchorLines([], [{ text: 'BANG!', type: 'action' }], { newId: seq('o') }).entries;
    const r = reanchorLines(o, [{ text: 'BANG!', type: 'dialogue' }], { newId: seq('n') });
    expect(r.entries[0]!.id).toBe('o1');
    expect(r.entries[0]!.type).toBe('dialogue');
  });

  it('falls back gracefully when the diff is too large for Myers', () => {
    const next = BASE.toReversed();
    const r = run(old, next, { maxDiff: 1 });
    expect(new Set(ids(r))).toEqual(new Set(old.map((e) => e.id)));
  });

  it('accepts entries in any order', () => {
    const shuffled = [old[3]!, old[0]!, ...old.slice(4), old[1]!, old[2]!];
    expect(ids(run(shuffled, BASE))).toEqual(old.map((e) => e.id));
  });

  it('rejects duplicate generated ids', () => {
    expect(() => run(old, [...BASE, 'New line.'], { newId: () => 'o1' })).toThrow(/duplicate/);
  });

  it('scales to long scripts', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `Line ${i}: the quick brown fox ${i % 7}.`);
    const o = initial(big);
    const next = [...big];
    next.splice(100, 50); // delete
    next.splice(2000, 0, ...Array.from({ length: 30 }, (_, i) => `Inserted ${i}`)); // insert
    next[3000] = next[3000]!.replace('quick', 'slow'); // edit
    const moved = next.splice(500, 20); // move a block to the end
    next.push(...moved);
    const t0 = performance.now();
    const r = run(o, next);
    const ms = performance.now() - t0;
    expect(r.added).toHaveLength(30);
    expect(r.removed).toHaveLength(50);
    expect(r.entries.find((e) => e.text.includes('slow'))!.id).toBe('o3021');
    expect(ms).toBeLessThan(5000);
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
});

const byText = (r: { entries: LineIdEntry[] }, t: string) =>
  r.entries.find((e) => e.text.startsWith(t))!.id;

describe('reanchorScript + shots', () => {
  const oldDoc = parseFountain(sample);
  const oldIds = assignLineIds(oldDoc, seq('L'));

  // Shots reference line ids, as in shots/<id>.json.
  const shots = {
    s1: [byText({ entries: oldIds }, 'EXT. CLIFFSIDE'), byText({ entries: oldIds }, 'Wind whips')],
    s2: [byText({ entries: oldIds }, 'My father'), byText({ entries: oldIds }, 'He said')],
    s3: [byText({ entries: oldIds }, 'Dust.'), byText({ entries: oldIds }, 'Okay. Okay.')],
    s4: [byText({ entries: oldIds }, 'SILENCE.')],
  };

  it('keeps shot references valid across a realistic outside edit', () => {
    const edited = sample
      // rename a character: cue lines are not anchorable, so no line id changes
      .replaceAll('JONAS', 'TOMAS')
      // typo-level dialogue edit
      .replace('My father kept the light burning', 'My father kept this light burning')
      // insert a new action line
      .replace('Dust. Mara', 'Rain hammers the windows.\nDust. Mara')
      // delete a line
      .replace('\n!SILENCE.\n', '\n')
      // move the dual-dialogue block before the knock
      .replace('MARA ^\nGo away, Jonas.\n\n', '')
      .replace('A KNOCK at the door.', 'MARA ^\nGo away, Jonas.\n\nA KNOCK at the door.');

    const r = reanchorScript(oldIds, edited, { newId: seq('N') });
    const live = new Set(r.entries.map((e) => e.id));

    expect(r.added).toEqual(['N1']);
    expect(r.entries.find((e) => e.id === 'N1')!.text).toBe('Rain hammers the windows.');
    expect(r.removed.map((e) => e.text)).toEqual(['SILENCE.']);
    expect(byText(r, 'My father kept this')).toBe(shots.s2[0]);
    expect(byText(r, 'Mara?')).toBe(byText({ entries: oldIds }, 'Mara?'));
    expect(byText(r, 'Go away')).toBe(byText({ entries: oldIds }, 'Go away'));

    const remapped = Object.fromEntries(
      Object.entries(shots).map(([k, v]) => [k, remapLineRefs(v, r)]),
    );
    expect(remapped.s1).toEqual(shots.s1);
    expect(remapped.s2).toEqual(shots.s2);
    expect(remapped.s3).toEqual(shots.s3);
    expect(remapped.s4).toEqual([]); // its only line was deleted
    for (const refs of Object.values(remapped))
      for (const id of refs) expect(live.has(id)).toBe(true);

    // ordinals follow the new script
    expect(r.entries.map((e) => e.ordinal)).toEqual(r.doc.lines.map((l) => l.ordinal));
  });
});
