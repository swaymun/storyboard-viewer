/**
 * Live screenplay formatting for the script editor: every physical line gets a class for the
 * Fountain element it belongs to (`cm-fx-scene_heading`, `cm-fx-character`, …), inferred by the
 * same parser the format package uses, so what you see is what the storyboard will store.
 * Inline notes `[[…]]` get a mark. Only the visible part of the document is decorated.
 */
import { RangeSetBuilder, type Text } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import { parseFountain, type FountainDocument } from '@storyboard-viewer/format';

const lineDeco = new Map<string, Decoration>();
const deco = (cls: string) => {
  let d = lineDeco.get(cls);
  if (!d) lineDeco.set(cls, (d = Decoration.line({ class: cls })));
  return d;
};
const noteMark = Decoration.mark({ class: 'cm-fx-inline-note' });
const emphasisMark = Decoration.mark({ class: 'cm-fx-emphasis' });

/** Element type of each physical line (0-based), e.g. for tests and the Tab helpers. */
export function lineTypes(doc: FountainDocument): Array<string | null> {
  const out: Array<string | null> = Array.from(
    { length: doc.source.split('\n').length },
    () => null,
  );
  for (const el of doc.elements)
    for (let i = el.startLine; i <= el.endLine; i++) {
      let cls: string = el.type;
      if (el.type === 'character' || el.type === 'dialogue' || el.type === 'parenthetical') {
        if (/V\.?O\.?|O\.?S\.?/i.test(el.extension ?? '')) cls += ' vo';
      }
      out[i] = cls;
    }
  return out;
}

function build(view: EditorView, parsed: FountainDocument): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const types = lineTypes(parsed);
  const doc: Text = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const t = types[line.number - 1];
      if (t) {
        const cls = t
          .split(' ')
          .map((x) => `cm-fx-${x}`)
          .join(' ');
        b.add(line.from, line.from, deco(`cm-fx ${cls}`));
        // inline marks: notes and emphasis (rendered, the markers stay in the text)
        const text = line.text;
        const marks: Array<[number, number, Decoration]> = [];
        for (const m of text.matchAll(/\[\[[\s\S]*?\]\]/g))
          marks.push([line.from + m.index!, line.from + m.index! + m[0].length, noteMark]);
        for (const m of text.matchAll(/(\*{1,3}|_)(?=\S)(.+?)(?<=\S)\1/g))
          marks.push([line.from + m.index!, line.from + m.index! + m[0].length, emphasisMark]);
        marks.sort((x, y) => x[0] - y[0]);
        let last = line.from;
        for (const [a, z, d] of marks) {
          if (a < last) continue;
          b.add(a, z, d);
          last = z;
        }
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

export const fountainHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    parsed: FountainDocument;
    constructor(view: EditorView) {
      this.parsed = parseFountain(view.state.doc.toString());
      this.decorations = build(view, this.parsed);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.parsed = parseFountain(u.state.doc.toString());
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view, this.parsed);
    }
  },
  { decorations: (v) => v.decorations },
);
