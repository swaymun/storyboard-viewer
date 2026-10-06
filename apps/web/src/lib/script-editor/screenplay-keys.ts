/**
 * Screenwriting keys for the plain-Fountain editor. Tab never leaves the editor (press Esc, then
 * Tab, or Ctrl+M / Shift+Alt+M on a Mac, to move focus on with the keyboard: CodeMirror's
 * tab-focus mode), and it never inserts a tab character. Instead:
 *
 * - **Empty line**: Tab cycles the element you are about to write: Character → Scene heading
 *   ("INT. ") → Transition ("> ") → back to Action (what you type is upper-cased; a blank line is
 *   added above a cue or heading if needed). Shift+Tab cycles backwards. A muted hint shows it.
 * - **Character cue or dialogue line, cursor at the end**: Tab starts a parenthetical on the next
 *   line ("(" … ")" with the cursor inside).
 * - **Parenthetical, cursor at the end**: Tab moves to a new dialogue line below it.
 * - **Dialogue, cursor inside the line**: Tab wraps / unwraps the line in parentheses.
 * - **Action line with text**: Tab upper-cases it (a character cue or a scene heading).
 */
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
  type KeyBinding,
} from '@codemirror/view';
import { parseFountain } from '@storyboard-viewer/format';
import { lineTypes } from './fountain-highlight';

export type ElementMode = 'character' | 'scene' | 'transition';
const CYCLE: Array<ElementMode | null> = [null, 'character', 'scene', 'transition'];
const PREFIX: Record<ElementMode, string> = { character: '', scene: 'INT. ', transition: '> ' };
const HINT: Record<ElementMode, string> = {
  character: 'CHARACTER',
  scene: 'INT./EXT. PLACE - TIME',
  transition: 'CUT TO:',
};

interface Mode {
  /** Start of the line the mode applies to. */
  line: number;
  kind: ElementMode;
}

const setMode = StateEffect.define<Mode | null>();

class Hint extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(o: Hint) {
    return o.text === this.text;
  }
  override toDOM() {
    const el = document.createElement('span');
    el.className = 'sb-element-hint';
    el.textContent = this.text;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

const modeField = StateField.define<{ mode: Mode | null; deco: DecorationSet }>({
  create: () => ({ mode: null, deco: Decoration.none }),
  update(v, tr) {
    let mode = v.mode;
    if (mode && tr.docChanged) mode = { ...mode, line: tr.changes.mapPos(mode.line, -1) };
    for (const e of tr.effects) if (e.is(setMode)) mode = e.value;
    // the mode lasts while the cursor stays on its line
    if (mode && (tr.selection || tr.docChanged)) {
      const head = tr.state.selection.main.head;
      if (tr.state.doc.lineAt(head).from !== tr.state.doc.lineAt(mode.line).from) mode = null;
    }
    let deco = Decoration.none;
    if (mode) {
      const line = tr.state.doc.lineAt(mode.line);
      if (line.text === PREFIX[mode.kind])
        deco = Decoration.set([
          Decoration.widget({ widget: new Hint(HINT[mode.kind]), side: 1 }).range(line.to),
        ]);
    }
    return { mode, deco };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** Character mode: typed letters are upper case. */
const upperInput = EditorView.inputHandler.of((view, from, to, text) => {
  const mode = view.state.field(modeField).mode;
  if (!mode || text === text.toUpperCase()) return false;
  if (view.state.doc.lineAt(from).from !== view.state.doc.lineAt(mode.line).from) return false;
  view.dispatch({
    changes: { from, to, insert: text.toUpperCase() },
    selection: { anchor: from + text.length },
    userEvent: 'input.type',
  });
  return true;
});

function typeOfLine(view: EditorView, n: number): string | null {
  const types = lineTypes(parseFountain(view.state.doc.toString()));
  return types[n - 1]?.split(' ')[0] ?? null;
}

function cycle(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const cur = state.field(modeField).mode;
  const curKind = cur && state.doc.lineAt(cur.line).from === line.from ? cur.kind : null;
  const i = CYCLE.indexOf(curKind);
  const next = CYCLE[(i + dir + CYCLE.length) % CYCLE.length]!;
  const changes: Array<{ from: number; to?: number; insert: string }> = [];
  let lineFrom = line.from;
  // a character cue or scene heading needs a blank line above it
  if (next && next !== 'transition' && line.number > 1) {
    const above = state.doc.line(line.number - 1);
    if (above.text.trim()) {
      changes.push({ from: line.from, insert: '\n' });
      lineFrom = line.from + 1;
    }
  }
  const prefix = next ? PREFIX[next] : '';
  changes.push({ from: line.from, to: line.to, insert: prefix });
  view.dispatch({
    changes,
    selection: { anchor: lineFrom + prefix.length },
    effects: setMode.of(next ? { line: lineFrom, kind: next } : null),
    userEvent: 'input',
  });
  return true;
}

/** Tab / Shift+Tab: see the module comment. Always handled while editable. */
export function screenplayTab(view: EditorView, dir: 1 | -1, editable: boolean): boolean {
  if (!editable) return false;
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const text = line.text;
  const mode = state.field(modeField).mode;
  const prefixOnly =
    !text.trim() ||
    (mode && state.doc.lineAt(mode.line).from === line.from && text === PREFIX[mode.kind]);
  if (sel.empty && prefixOnly) return cycle(view, dir);
  if (!sel.empty) return true; // keep the selection; no tab characters in Fountain
  const type = typeOfLine(view, line.number);
  const atEnd = sel.head === line.to;
  if (dir === 1 && (type === 'character' || type === 'dialogue') && atEnd) {
    view.dispatch({
      changes: { from: line.to, insert: '\n()' },
      selection: { anchor: line.to + 2 },
      userEvent: 'input',
    });
    return true;
  }
  if (type === 'parenthetical') {
    const t = text.trim();
    if (dir === 1 && (atEnd || sel.head === line.to - 1) && t.endsWith(')')) {
      view.dispatch({
        changes: { from: line.to, insert: '\n' },
        selection: { anchor: line.to + 1 },
        userEvent: 'input',
      });
      return true;
    }
    if (dir === -1 && /^\(.*\)$/.test(t)) {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: t.slice(1, -1) } });
      return true;
    }
    return true;
  }
  if (type === 'dialogue') {
    const t = text.trim();
    const next = /^\(.*\)$/.test(t) ? t.slice(1, -1) : `(${t})`;
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
    return true;
  }
  if (dir === 1 && text.trim() && text !== text.toUpperCase()) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: text.toUpperCase() } });
    return true;
  }
  return true;
}

export function screenplayKeys(editable: () => boolean): {
  extension: Extension;
  keys: KeyBinding[];
} {
  return {
    extension: [modeField, upperInput],
    keys: [
      { key: 'Tab', run: (v) => screenplayTab(v, 1, editable()) },
      { key: 'Shift-Tab', run: (v) => screenplayTab(v, -1, editable()) },
    ],
  };
}
