// The shot highlight covers only the exact words of a shot (no full-width line backgrounds, nothing
// on blank lines, no gutter), several shots can share a line, and typing at a shot's edge does not
// grow it.
import { join } from 'node:path';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { beforeAll, describe, expect, it } from 'vitest';
import { addShot, setShotSpan, type SbdProject } from '@storyboard-viewer/format';
import { openProjectPath } from '@storyboard-viewer/format/node';
import { setAnnotations, setAnnotationUi, shotAnnotations } from './annotations';
import { computeAnnotations } from './geometry';

const EXAMPLE = join(import.meta.dirname, '../../../../../examples/minimal.sbd');
let base: SbdProject;
beforeAll(async () => {
  base = (await openProjectPath(EXAMPLE)).project;
});

function setup(p: SbdProject = base) {
  const ann = shotAnnotations({ onSelect() {}, onHandle() {}, onShotMenu() {} }, () => true);
  let state = EditorState.create({ doc: p.script!, extensions: [ann.extension] });
  state = state.update({ effects: setAnnotations.of(computeAnnotations(p)) }).state;
  return state;
}

/** All decorations as {from, to, class, isLine}. */
function decos(state: EditorState) {
  const out: Array<{ from: number; to: number; cls: string; line: boolean }> = [];
  for (const src of state.facet(EditorView.decorations)) {
    const set = (typeof src === 'function' ? null : src) as DecorationSet | null;
    set?.between(0, state.doc.length, (from, to, d: Decoration) => {
      const spec = d.spec as { class?: string };
      out.push({ from, to, cls: spec.class ?? '', line: from === to });
    });
  }
  return out;
}

describe('shot annotations', () => {
  it('tints only the text of a shot’s lines, never blank lines', () => {
    const state = setup();
    const marks = decos(state).filter((d) => !d.line && d.cls.includes('sb-text'));
    expect(marks.length).toBeGreaterThan(5);
    for (const m of marks) {
      const text = state.doc.sliceString(m.from, m.to);
      expect(text.trim()).toBe(text); // no leading/trailing space
      expect(text.length).toBeGreaterThan(0);
      const line = state.doc.lineAt(m.from);
      expect(m.to).toBeLessThanOrEqual(line.to); // within one line
    }
    // blank lines get no mark
    for (const m of marks) expect(state.doc.lineAt(m.from).text.trim()).not.toBe('');
    // the line decorations themselves carry no background class of their own
    expect(decos(state).some((d) => d.line && /sb-(hover|active)\b/.test(d.cls))).toBe(false);
  });

  it('marks the active shot on its text and shows the drag preview', () => {
    let state = setup();
    state = state.update({ effects: setAnnotationUi.of({ active: 'climb' }) }).state;
    const active = decos(state).filter(
      (d) => d.cls.includes('sb-text') && d.cls.includes('sb-active'),
    );
    expect(active.map((d) => state.doc.sliceString(d.from, d.to))).toEqual([
      'INT. LANTERN ROOM - NIGHT',
      'Maya, 30s, climbs the last step, out of breath. She holds a matchbox.',
    ]);
    // handles at both ends of the open shot (widgets, no gutter)
    const widgets = decos(state).filter((d) => d.line && d.cls === '');
    expect(widgets.length).toBeGreaterThanOrEqual(2);
    state = state.update({
      effects: setAnnotationUi.of({ preview: { shot: 'climb', from: 10, to: 40 } }),
    }).state;
    expect(decos(state).some((d) => d.cls.includes('sb-preview-text'))).toBe(true);
  });

  it('several shots in one line, each on its words; typing at an edge stays outside', () => {
    const line = base.ids.lines.find((l) => l.text.startsWith('Waves crash'))!.id;
    let p = addShot(base, { id: 'rocks' }).project;
    p = setShotSpan(p, 'rocks', { line, offset: 20 }, { line, offset: 31 });
    let state = setup(p);
    const words = () =>
      decos(state)
        .filter((d) => !d.line && d.cls.includes('sb-text'))
        .map((d) => state.doc.sliceString(d.from, d.to))
        .filter((t) => /Waves|rocks|tower/.test(t));
    // "opening" keeps the words before; the rest of its text is no longer in a shot
    expect(words()).toEqual(['Waves crash against', 'black rocks']);
    // type right after "black rocks" (outside) and inside it ("black wet rocks")
    const end = p.script!.indexOf('black rocks') + 'black rocks'.length;
    state = state.update({ changes: { from: end, insert: ' and sand' } }).state;
    expect(words()).toContain('black rocks');
    const inside = p.script!.indexOf('rocks');
    state = state.update({ changes: { from: inside, insert: 'wet ' } }).state;
    expect(words()).toContain('black wet rocks');
  });
});
