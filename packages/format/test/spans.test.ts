import { describe, expect, it } from 'vitest';
import {
  addCue,
  addAsset,
  addShot,
  buildAnimatic,
  createProject,
  mapSpanPos,
  mapTextOffset,
  mergeProjects,
  mergeShots,
  moveShotWithLines,
  parseFountain,
  locateSpan,
  removeLines,
  replaceScriptRange,
  serializeProject,
  setScript,
  setShotLines,
  setShotSpan,
  shotTexts,
  sourceToTextOffset,
  splitShot,
  syncScript,
  textLookup,
  textOffsetToSource,
  treeReader,
  loadProject,
  updateLine,
  validateProject,
  type SbdProject,
  type ShotRef,
} from '../src/index.js';

const SCRIPT = `INT. ALLEY - NIGHT

Rain. Neon. A puddle shivers.

JO
I was running from the cops, the cars were everywhere.
(beat)
And then the lights went out.

Silence.
`;

const LINE = 'I was running from the cops, the cars were everywhere.';

function project(): SbdProject {
  return createProject({ title: 'Spans', preset: 'film', script: SCRIPT });
}
const idOf = (p: SbdProject, prefix: string) =>
  p.ids.lines.find((l) => l.text.startsWith(prefix))!.id;
const ref = (p: SbdProject, id: string) => p.ids.shots.find((s) => s.id === id)!;
const spanText = (p: SbdProject, id: string) =>
  shotTexts(ref(p, id), textLookup(p.ids.lines))
    .map((t) => t.text)
    .join('\n');
const errors = (p: SbdProject) => validateProject(p).filter((i) => i.severity === 'error');
const warnings = (p: SbdProject) => validateProject(p).filter((i) => i.severity === 'warning');

/** Three shots in one dialogue line: the speaker, the cops, the cars. */
function threeInOneLine() {
  let p = project();
  const l = idOf(p, 'I was running');
  const at = (s: string) => LINE.indexOf(s);
  p = addShot(p, { id: 'speaker', lines: [l] }).project;
  p = addShot(p, {
    id: 'cops',
    start: { line: l, offset: at('the cops') },
    end: { line: l, offset: at('the cops') + 'the cops'.length },
  }).project;
  p = addShot(p, {
    id: 'cars',
    start: { line: l, offset: at('the cars') },
    end: { line: l, offset: at('the cars') + 'the cars'.length },
  }).project;
  return { p, l };
}

describe('Fountain text positions', () => {
  it('maps text offsets to source positions past markers, indentation and inline notes', () => {
    const src = '!Forced action.\n\n  .MONTAGE\n\nShe [[aside]] waves.\n';
    const doc = parseFountain(src);
    const [forced, heading, waves] = doc.lines;
    expect(forced!.text).toBe('Forced action.');
    expect(src.slice(textOffsetToSource(forced!, 0), textOffsetToSource(forced!, 6))).toBe(
      'Forced',
    );
    expect(heading!.text).toBe('MONTAGE');
    expect(src[textOffsetToSource(heading!, 0)]).toBe('M');
    expect(waves!.text).toBe('She  waves.');
    // "waves" starts after the note in the source
    const w = waves!.text.indexOf('waves');
    expect(src.slice(textOffsetToSource(waves!, w), textOffsetToSource(waves!, w + 5))).toBe(
      'waves',
    );
    expect(sourceToTextOffset(waves!, src.indexOf('waves'))).toBe(w);
    expect(textOffsetToSource(waves!, waves!.text.length)).toBe(src.indexOf('waves.') + 6);
  });
});

describe('sub-line shots (format 0.2)', () => {
  it('several shots in one line, each on exactly its words', () => {
    const { p } = threeInOneLine();
    expect(spanText(p, 'speaker')).toBe('I was running from ');
    expect(spanText(p, 'cops')).toBe('the cops');
    expect(spanText(p, 'cars')).toBe('the cars');
    expect(ref(p, 'cops')).toMatchObject({ start: { offset: 19 }, end: { offset: 27 } });
    expect(errors(p)).toEqual([]);
    expect(warnings(p)).toEqual([]); // sharing a line without overlap is fine
    expect(p.manifest.format_version).toBe('0.3.0'); // created at the current version
  });

  it('a span can cross lines and whole-line shots stay as they were', () => {
    let p = project();
    const a = idOf(p, 'I was running');
    const b = idOf(p, 'And then');
    p = addShot(p, {
      id: 'run',
      start: { line: a, offset: 19 },
      end: { line: b, offset: 8 },
    }).project;
    expect(ref(p, 'run').lines).toHaveLength(3); // dialogue, (beat), dialogue
    expect(spanText(p, 'run')).toBe('the cops, the cars were everywhere.\n(beat)\nAnd then');
    const json = JSON.parse(serializeProject(p)['ids.json']!) as { shots: ShotRef[] };
    expect(json.shots[0]).toEqual({
      id: 'run',
      lines: ref(p, 'run').lines,
      start: { line: a, offset: 19 },
      end: { line: b, offset: 8 },
    });
    // whole lines: no offsets written
    const fresh = project();
    const w = idOf(fresh, 'I was running');
    const q = addShot(fresh, { id: 'w', lines: [w] }).project;
    expect(ref(q, 'w')).toEqual({ id: 'w', lines: [w] });
    expect(q.manifest.format_version).toBe('0.3.0'); // new projects are 0.3
  });

  it('making a shot inside another one keeps the part before; no overlaps', () => {
    let q = project();
    const l = idOf(q, 'I was running');
    q = addShot(q, { id: 'wide', lines: [idOf(q, 'Rain'), l, idOf(q, '(beat)')] }).project;
    q = addShot(q, { id: 'cops' }).project;
    q = setShotSpan(q, 'cops', { line: l, offset: 19 }, { line: l, offset: 27 });
    expect(spanText(q, 'wide')).toBe('Rain. Neon. A puddle shivers.\nI was running from ');
    expect(spanText(q, 'cops')).toBe('the cops');
    expect(warnings(q)).toEqual([]);
    // a span covering a whole shot leaves that shot without lines
    q = setShotSpan(q, 'cops', { line: idOf(q, 'Rain'), offset: 0 }, { line: l, offset: 27 });
    expect(ref(q, 'wide').lines).toEqual([]);
    expect(errors(q)).toEqual([]);
  });

  it('typing inside a span grows it; typing at its edges does not', () => {
    const { p, l } = threeInOneLine();
    const src = p.script!;
    const lineAt = src.indexOf(LINE);
    // inside "the cops": "the big cops"
    let r = replaceScriptRange(p, lineAt + 23, lineAt + 23, 'big ');
    expect(spanText(r.project, 'cops')).toBe('the big cops');
    expect(spanText(r.project, 'cars')).toBe('the cars');
    // right after the end of "the cops": outside
    r = replaceScriptRange(p, lineAt + 27, lineAt + 27, ' and dogs');
    expect(spanText(r.project, 'cops')).toBe('the cops');
    // right before the start of "the cars": outside
    r = replaceScriptRange(p, lineAt + 29, lineAt + 29, 'all ');
    expect(spanText(r.project, 'cars')).toBe('the cars');
    expect(r.project.ids.lines.find((x) => x.id === l)!.text).toContain('all the cars');
    // replacing the selected words of a span keeps the shot on the new words
    r = replaceScriptRange(p, lineAt + 19, lineAt + 27, 'the police');
    expect(spanText(r.project, 'cops')).toBe('the police');
    expect(errors(r.project)).toEqual([]);
  });

  it('Enter inside a span splits it over two lines; deleting it empties the shot', () => {
    const { p } = threeInOneLine();
    const at = p.script!.indexOf(LINE) + 23; // "the |cops"
    const r = replaceScriptRange(p, at, at, '\n');
    // (line text is trimmed: the space before the break is not part of either line)
    expect(spanText(r.project, 'cops')).toBe('the\ncops');
    expect(spanText(r.project, 'cars')).toBe('the cars');
    expect(errors(r.project)).toEqual([]);
    const from = p.script!.indexOf('the cops');
    const d = replaceScriptRange(p, from, from + 8, '');
    expect(ref(d.project, 'cops').lines).toEqual([]);
    expect(errors(d.project)).toEqual([]);
  });

  it('several changes in one commit map each boundary exactly', () => {
    const { p } = threeInOneLine();
    const lineAt = p.script!.indexOf(LINE);
    const a = lineAt; // "Then " before "I"
    const b = lineAt + 33; // "the cars" -> "the red cars"
    const next = `${p.script!.slice(0, a)}Then ${p.script!.slice(a, b)}red ${p.script!.slice(b)}`;
    const r = replaceScriptRange(p, a, b, next.slice(a, b + 9), {
      changes: [
        { from: a, to: a, length: 5, text: 'Then ' },
        { from: b, to: b, length: 4, text: 'red ' },
      ],
    });
    expect(r.project.script).toBe(next);
    expect(spanText(r.project, 'speaker')).toBe('Then I was running from ');
    expect(spanText(r.project, 'cops')).toBe('the cops');
    expect(spanText(r.project, 'cars')).toBe('the red cars');
  });

  it('agent edits (update_line) move offsets with the words', () => {
    const { p, l } = threeInOneLine();
    const r = updateLine(
      p,
      l,
      'Honestly, I was running from the cops, the trucks were everywhere.',
    );
    expect(spanText(r.project, 'speaker')).toBe('Honestly, I was running from ');
    expect(spanText(r.project, 'cops')).toBe('the cops');
    expect(spanText(r.project, 'cars')).toBe('the trucks');
  });

  it('hand edits and set_script re-anchor offsets through each line’s text', () => {
    const { p } = threeInOneLine();
    const edited = p.script!.replace('the cops', 'the angry cops').replace('Rain.', 'Heavy rain.');
    const r = setScript(p, edited);
    expect(spanText(r.project, 'cops')).toBe('the angry cops');
    expect(spanText(r.project, 'cars')).toBe('the cars');
    // the same through loadProject (script.fountain edited, ids.json stale)
    const files = serializeProject(p);
    files['script.fountain'] = edited;
    const tree = Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]),
    );
    return loadProject(treeReader(tree)).then((loaded) => {
      expect(loaded.reanchor).toBeDefined();
      expect(spanText(loaded.project, 'cops')).toBe('the angry cops');
      expect(loaded.issues.filter((i) => i.severity === 'error')).toEqual([]);
    });
  });

  it('a removed line drops its offsets safely', () => {
    let p = project();
    const a = idOf(p, 'I was running');
    const b = idOf(p, 'And then');
    p = addShot(p, {
      id: 'run',
      start: { line: a, offset: 19 },
      end: { line: b, offset: 8 },
    }).project;
    const r = removeLines(p, [b]);
    expect(ref(r.project, 'run').end).toBeUndefined();
    expect(spanText(r.project, 'run')).toBe('the cops, the cars were everywhere.\n(beat)');
    expect(errors(r.project)).toEqual([]);
  });

  it('split at a character and merge back', () => {
    let p = project();
    const l = idOf(p, 'I was running');
    p = addShot(p, { id: 'run', lines: [l] }).project;
    const s = splitShot(p, 'run', l, { offset: 19, id: 'cops' });
    expect(spanText(s.project, 'run')).toBe('I was running from ');
    expect(spanText(s.project, 'cops')).toBe(LINE.slice(19));
    expect(s.project.ids.shots.map((x) => x.id)).toEqual(['run', 'cops']);
    const m = mergeShots(s.project, 'run', 'cops');
    expect(ref(m, 'run')).toEqual({ id: 'run', lines: [l] });
    expect(() => splitShot(p, 'run', l, { offset: 0 })).toThrow(/first one|inside/);
  });

  it('moving a shot that shares a line with another only changes the order', () => {
    const { p } = threeInOneLine();
    const moved = moveShotWithLines(p, 'cars', { index: 0 });
    expect(moved.script).toBe(p.script);
    expect(moved.ids.shots.map((s) => s.id)).toEqual(['cars', 'speaker', 'cops']);
  });

  it('locates a text inside lines (MCP `text`)', () => {
    const { p, l } = threeInOneLine();
    const t = textLookup(p.ids.lines);
    expect(locateSpan([l], t, 'the cars')).toEqual({
      start: { line: l, offset: 29 },
      end: { line: l, offset: 37 },
    });
    expect(locateSpan([l], t, 'the', 2)!.start.offset).toBe(29);
    expect(locateSpan([l], t, 'nope')).toBeNull();
    const b = idOf(p, '(beat)');
    expect(locateSpan([l, b], t, 'everywhere.\n(beat')).toEqual({
      start: { line: l, offset: LINE.indexOf('everywhere') },
      end: { line: b, offset: 5 },
    });
  });
});

describe('typing around whole-line shots (Enter, Enter leaves the shot)', () => {
  it('one Enter continues the shot, two Enters start outside it', () => {
    let p = project();
    const rain = idOf(p, 'Rain');
    p = addShot(p, { id: 'rain', lines: [rain] }).project;
    const end = p.script!.indexOf('shivers.') + 'shivers.'.length;
    const one = replaceScriptRange(p, end, end, '\nThunder.');
    expect(ref(one.project, 'rain').lines).toHaveLength(2);
    const two = replaceScriptRange(p, end, end, '\n\nThunder.');
    expect(ref(two.project, 'rain').lines).toEqual([rain]);
    // typing at the end of a whole line stays in the shot
    const more = replaceScriptRange(p, end, end, ' Again.');
    expect(spanText(more.project, 'rain')).toBe('Rain. Neon. A puddle shivers. Again.');
  });

  it('a shot ending mid-line never grabs the next line', () => {
    const { p } = threeInOneLine();
    const end = p.script!.indexOf('everywhere.') + 'everywhere.'.length;
    const r = replaceScriptRange(p, end, end, '\nWe hid.');
    expect(ref(r.project, 'cars').lines).toHaveLength(1);
  });
});

describe('merging with character spans', () => {
  it('agent edit of a span line while the user types elsewhere', () => {
    const { p: base, l } = threeInOneLine();
    const rain = base.script!.indexOf('Rain.');
    const ours = replaceScriptRange(base, rain, rain, 'Cold ').project;
    const theirs = updateLine(
      base,
      l,
      'Look, I was running from the cops, the cars were everywhere.',
    ).project;
    const m = mergeProjects(base, ours, theirs);
    expect(m.conflicts).toEqual([]);
    expect(m.project.script).toContain('Cold Rain.');
    expect(spanText(m.project, 'cops')).toBe('the cops');
    expect(spanText(m.project, 'cars')).toBe('the cars');
    expect(spanText(m.project, 'speaker')).toBe('Look, I was running from ');
  });

  it('user typing inside a span while the agent adds a shot elsewhere', () => {
    const { p: base } = threeInOneLine();
    const at = base.script!.indexOf('the cops') + 4;
    const ours = replaceScriptRange(base, at, at, 'angry ').project;
    const theirs = addShot(base, { id: 'silence', lines: [idOf(base, 'Silence')] }).project;
    const m = mergeProjects(base, ours, theirs);
    expect(spanText(m.project, 'cops')).toBe('the angry cops');
    expect(ref(m.project, 'silence').lines).toHaveLength(1);
    // the shared line stays shared by all three shots
    expect(m.project.ids.shots.filter((s) => s.lines.length === 1).length).toBe(4);
    expect(errors(m.project)).toEqual([]);
  });
});

describe('span mapping primitives', () => {
  it('mapSpanPos: insertions at a boundary stay outside, replacements inside', () => {
    const ins = [{ from: 5, to: 5, length: 3, text: 'abc' }];
    expect(mapSpanPos(5, ins, 'start')).toBe(8);
    expect(mapSpanPos(5, ins, 'end')).toBe(5);
    expect(mapSpanPos(5, ins, 'lineEnd')).toBe(8);
    expect(mapSpanPos(5, [{ from: 5, to: 5, length: 4, text: '\nabc' }], 'lineEnd')).toBe(5);
    expect(mapSpanPos(5, [{ from: 5, to: 5, length: 4, text: 'ab\nc' }], 'lineStart')).toBe(8);
    const rep = [{ from: 2, to: 6, length: 1 }];
    expect(mapSpanPos(2, rep, 'start')).toBe(2);
    expect(mapSpanPos(6, rep, 'end')).toBe(3);
    expect(mapSpanPos(4, rep, 'start')).toBe(2);
    expect(mapSpanPos(4, rep, 'end')).toBe(3);
    expect(mapSpanPos(10, rep, 'end')).toBe(7);
    expect(mapTextOffset('the cars', 'the red cars', 0, 'start')).toBe(0);
    expect(mapTextOffset('the cars', 'the red cars', 4, 'start')).toBe(8);
    expect(mapTextOffset('the cars', 'the red cars', 8, 'end')).toBe(12);
  });
});

describe('animatic: a line split between shots', () => {
  it('shares the line’s time in proportion to the characters', () => {
    const { p } = threeInOneLine();
    const a = buildAnimatic(p);
    const parts = a.shots.map((s) => s.lines.find((x) => x.from !== undefined));
    const lens = parts.map((x) => x!.end - x!.start);
    // 19 : 8 : 25 characters ("I was running from ", "the cops", ", the cars…" minus the gap)
    expect(lens[0]! / lens[1]!).toBeCloseTo(19 / 8, 1);
    expect(a.shots[1]!.end - a.shots[1]!.start).toBeLessThan(1.5);
  });

  it('a cue on the line plays from the first part and sets the total', () => {
    const { p: q, l } = threeInOneLine();
    let p = addAsset(q, {
      id: 'vo',
      name: 'VO',
      kind: 'audio',
      src: 'media/vo.mp3',
      duration: 6,
    }).project;
    p = addCue(p, { id: 'c1', asset: 'vo', in: 0, out: 3.5, target: { line: l } }).project;
    const a = buildAnimatic(p);
    const parts = a.shots.map((s) => s.lines.find((x) => x.id === l)!);
    const total = parts.reduce((sum, x) => sum + (x.end - x.start), 0);
    expect(total).toBeCloseTo(3.5, 1);
    expect(a.cues[0]!.start).toBe(parts[0]!.start);
  });
});

describe('format 0.1 files stay valid', () => {
  it('whole-line shots load and validate without changes', () => {
    let p = project();
    p = addShot(p, { id: 'a', lines: [idOf(p, 'Rain')] }).project;
    const v01 = { ...p, manifest: { ...p.manifest, format_version: '0.1.0' } };
    expect(errors(v01)).toEqual([]);
    expect(syncScript(v01).project).toBe(v01);
    // a whole-line edit does not bump the version
    const r = setShotLines(v01, 'a', [idOf(p, 'Rain'), idOf(p, 'Silence')]);
    expect(r.manifest.format_version).toBe('0.1.0');
  });

  it('reports broken spans', () => {
    const { p, l } = threeInOneLine();
    const bad = structuredClone(p);
    bad.ids.shots[1]!.start = { line: idOf(p, 'Rain'), offset: 2 };
    expect(errors(bad).map((i) => i.code)).toContain('span-line');
    const empty = structuredClone(p);
    empty.ids.shots[1]!.end = { line: l, offset: 3 };
    expect(errors(empty).map((i) => i.code)).toContain('span-empty');
    const overlap = structuredClone(p);
    overlap.ids.shots[2]!.start = { line: l, offset: 20 };
    expect(warnings(overlap).map((i) => i.code)).toContain('shared-line');
    const schema = structuredClone(p);
    (schema.ids.shots[1]!.start as { offset: unknown }).offset = 'x';
    expect(errors(schema).length).toBeGreaterThan(0);
  });
});
