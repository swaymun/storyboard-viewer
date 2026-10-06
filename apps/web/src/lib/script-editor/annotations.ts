/**
 * Shot annotations inside the script editor (Genius-style, calm): the exact words a shot covers
 * get a light tint and a thin underline in the shot's colour (only the words: not the space around
 * them, not blank lines); hovering emphasises them, and the open shot is a little stronger. No
 * gutter, no numbers: the number lives on the shot's card. The open (or hovered) shot shows two
 * small handles at the ends of its text to drag its boundaries. Shots without lines show as
 * markers between lines. Line elements carry `data-line-id` / `data-shot-id` for agents and tests;
 * every mark carries `data-shot-id` too.
 *
 * The geometry comes from the committed project (`setAnnotations`) and is mapped through edits
 * typed since (with the same rules as the format: text typed right at a span's edge stays outside),
 * so highlights follow the text while typing.
 */
import {
  type ChangeSet,
  StateEffect,
  StateField,
  type Range,
  type Extension,
  type Text,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { mapSpanPos, type PosChange } from '@storyboard-viewer/format';
import type { Annotations, ShotGeom } from './geometry';

export interface AnnotationUi {
  active: string | null;
  hover: string | null;
  playing: string | null;
  /**
   * Animatic playback: the shot under the playhead and its part on the playing line, which
   * gets a stronger mark and a thin marker sweeping across it (`dur` seconds, started `elapsed`
   * seconds ago; `paused` holds it).
   */
  now: { shot: string; line: string | null; dur: number; elapsed: number; paused: boolean } | null;
  /** Drag preview of a shot's text while a handle is dragged (document positions). */
  preview: { shot: string; from: number; to: number } | null;
}

interface FieldValue {
  data: Annotations;
  ui: AnnotationUi;
  decorations: DecorationSet;
}

export const setAnnotations = StateEffect.define<Annotations>();
export const setAnnotationUi = StateEffect.define<Partial<AnnotationUi>>();

export interface AnnotationCallbacks {
  /** A shot without lines was clicked. */
  onSelect(id: string): void;
  /** Pointer went down on a boundary handle. */
  onHandle(id: string, edge: 'start' | 'end', e: MouseEvent): void;
  /**
   * A key on a focused boundary handle (←/→ move it by a word, Alt for a character; Esc/Enter go
   * back to the text). Return true when handled.
   */
  onHandleKey?(id: string, edge: 'start' | 'end', e: KeyboardEvent): boolean;
  /** Right click on a shot without lines. */
  onShotMenu(id: string, e: MouseEvent): void;
}

const mapData = (d: Annotations, changes: PosChange[], map: (p: number, a: number) => number) => ({
  lines: d.lines.map((l) => ({ ...l, pos: map(l.pos, 1) })),
  shots: d.shots.map((s) => {
    const out: ShotGeom = {
      ...s,
      pieces: s.pieces
        .map((x) => ({
          ...x,
          from: mapSpanPos(x.from, changes, x.fromSide),
          to: mapSpanPos(x.to, changes, x.toSide),
        }))
        .filter((x) => x.to > x.from),
    };
    if (s.marker) out.marker = { ...s.marker, pos: map(s.marker.pos, s.marker.side) };
    return out;
  }),
});

/**
 * A boundary handle: a 2 px bar just outside the shot's words with a larger invisible hit area
 * (CSS), reachable by keyboard after the text (Esc then Tab) and moved with ←/→.
 */
class Handle extends WidgetType {
  constructor(
    readonly shot: string,
    readonly edge: 'start' | 'end',
    readonly color: number,
    readonly label: string,
    readonly onKey: AnnotationCallbacks['onHandleKey'],
  ) {
    super();
  }
  override eq(o: Handle) {
    return (
      o.shot === this.shot &&
      o.edge === this.edge &&
      o.color === this.color &&
      o.label === this.label
    );
  }
  override toDOM() {
    const h = document.createElement('span');
    h.className = `sb-handle ${this.edge}`;
    h.dataset['edge'] = this.edge;
    h.dataset['handleShot'] = this.shot;
    h.style.setProperty('--shot-c', `var(--shot-${this.color})`);
    h.title =
      this.edge === 'start'
        ? 'Drag to change where this shot starts (Alt: by character)'
        : 'Drag to change where this shot ends (Alt: by character)';
    h.tabIndex = 0;
    h.setAttribute('role', 'button');
    h.setAttribute(
      'aria-label',
      `${this.edge === 'start' ? 'Start' : 'End'} of ${this.label}: ←/→ move it by a word, Alt+←/→ by a character`,
    );
    h.addEventListener('keydown', (e) => {
      if (this.onKey?.(this.shot, this.edge, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    return h;
  }
  override ignoreEvent() {
    return false;
  }
}

class LinelessWidget extends WidgetType {
  constructor(
    readonly shot: ShotGeom,
    readonly state: string,
  ) {
    super();
  }
  override eq(o: LinelessWidget) {
    return (
      o.shot.id === this.shot.id &&
      o.shot.index === this.shot.index &&
      o.shot.title === this.shot.title &&
      o.shot.color === this.shot.color &&
      o.state === this.state
    );
  }
  override toDOM() {
    const el = document.createElement('div');
    el.className = `sb-lineless ${this.state}`;
    el.dataset['shotId'] = this.shot.id;
    el.dataset['lineless'] = 'true';
    el.style.setProperty('--shot-c', `var(--shot-${this.shot.color})`);
    const t = document.createElement('span');
    t.className = 'sb-title';
    t.textContent = this.shot.title || `Shot ${this.shot.index + 1}`;
    el.append(t);
    el.setAttribute('role', 'button');
    el.setAttribute(
      'aria-label',
      `Shot ${this.shot.index + 1}${this.shot.title ? `: ${this.shot.title}` : ''} (no script text)`,
    );
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

function stateOf(s: ShotGeom, ui: AnnotationUi): string[] {
  return [ui.active === s.id ? 'active' : '', ui.hover === s.id ? 'hover' : '', s.dim ? 'dim' : '']
    .filter(Boolean)
    .map((x) => `sb-${x}`);
}

function build(
  doc: Text,
  data: Annotations,
  ui: AnnotationUi,
  editable: boolean,
  onKey?: AnnotationCallbacks['onHandleKey'],
): DecorationSet {
  const deco: Array<Range<Decoration>> = [];
  const clamp = (n: number) => Math.max(0, Math.min(doc.length, n));
  // per document line: line ID and the shots on it
  const perLine = new Map<number, { id?: string; shots: string[] }>();
  const entry = (n: number) => {
    let e = perLine.get(n);
    if (!e) perLine.set(n, (e = { shots: [] }));
    return e;
  };
  for (const l of data.lines) if (l.pos <= doc.length) entry(doc.lineAt(l.pos).number).id = l.id;
  const prev = ui.preview;
  for (const s of data.shots) {
    if (s.marker) {
      const widget = new LinelessWidget(s, stateOf(s, ui).join(' '));
      deco.push(
        Decoration.widget({ widget, block: true, side: s.marker.side }).range(clamp(s.marker.pos)),
      );
      continue;
    }
    if (prev?.shot === s.id) continue; // drawn as the preview below
    const st = stateOf(s, ui);
    const now = ui.now?.shot === s.id ? ui.now : null;
    if (now) st.push('sb-now-shot');
    const attrs = { style: `--shot-c: var(--shot-${s.color})`, 'data-shot-id': s.id };
    for (const piece of s.pieces) {
      const from = clamp(piece.from);
      const to = clamp(piece.to);
      if (to <= from) continue;
      // one mark per document line (pieces normally are)
      for (let pos = from; pos < to;) {
        const line = doc.lineAt(pos);
        const end = Math.min(to, line.to);
        if (end > pos) {
          const here = now && now.line && perLine.get(line.number)?.id === now.line;
          deco.push(
            Decoration.mark({
              class:
                ['sb-text', ...st, ...(here ? ['sb-now'] : [])].join(' ') +
                (here && now.paused ? ' sb-paused' : ''),
              attributes: here
                ? {
                    ...attrs,
                    style: `${attrs.style}; --sb-dur: ${Math.max(0.1, now.dur).toFixed(2)}s; --sb-delay: ${(-Math.max(0, now.elapsed)).toFixed(2)}s`,
                  }
                : attrs,
            }).range(pos, end),
          );
        }
        const e = entry(line.number);
        if (!e.shots.includes(s.id)) e.shots.push(s.id);
        pos = line.to + 1;
      }
    }
    const first = s.pieces[0];
    const last = s.pieces.at(-1);
    if (editable && first && last && (ui.active === s.id || ui.hover === s.id)) {
      const name = `Shot ${s.index + 1}${s.title ? `: ${s.title}` : ''}`;
      deco.push(
        Decoration.widget({
          widget: new Handle(s.id, 'start', s.color, name, onKey),
          side: -1,
        }).range(clamp(first.from)),
        Decoration.widget({
          widget: new Handle(s.id, 'end', s.color, name, onKey),
          side: 1,
        }).range(clamp(last.to)),
      );
    }
  }
  if (prev && prev.to > prev.from) {
    const geom = data.shots.find((x) => x.id === prev.shot);
    const color = geom?.color ?? 1;
    deco.push(
      Decoration.mark({
        class: 'sb-text sb-preview-text',
        attributes: { style: `--shot-c: var(--shot-${color})` },
      }).range(clamp(prev.from), clamp(prev.to)),
    );
  }
  for (const [n, e] of perLine) {
    if (n < 1 || n > doc.lines) continue;
    const line = doc.line(n);
    const attrs: Record<string, string> = {};
    const cls: string[] = [];
    if (e.id) {
      attrs['data-line-id'] = e.id;
      if (ui.playing === e.id) cls.push('sb-playing');
    }
    if (e.shots.length) {
      attrs['data-shot-id'] = e.shots[0]!;
      if (e.shots.length > 1) attrs['data-shot-ids'] = e.shots.join(' ');
      cls.push('sb-shot');
    }
    if (cls.length || Object.keys(attrs).length)
      deco.push(Decoration.line({ class: cls.join(' '), attributes: attrs }).range(line.from));
  }
  return Decoration.set(deco, true);
}

export interface ShotAnnotations {
  extension: Extension;
  /** Current annotation data (mapped through edits since the last `setAnnotations`). */
  data(view: EditorView): Annotations;
}

/** The changes of a transaction as `PosChange`s (old coordinates). */
function changesOf(changes: ChangeSet): PosChange[] {
  const out: PosChange[] = [];
  changes.iterChanges((fromA, toA, fromB, toB, inserted) =>
    out.push({ from: fromA, to: toA, length: toB - fromB, text: inserted.toString() }),
  );
  return out;
}

export function shotAnnotations(cb: AnnotationCallbacks, editable: () => boolean): ShotAnnotations {
  const field = StateField.define<FieldValue>({
    create(state) {
      const data: Annotations = { shots: [], lines: [] };
      const ui: AnnotationUi = {
        active: null,
        hover: null,
        playing: null,
        now: null,
        preview: null,
      };
      return { data, ui, decorations: build(state.doc, data, ui, editable(), cb.onHandleKey) };
    },
    update(v, tr) {
      let { data, ui } = v;
      let changed = false;
      if (tr.docChanged) {
        data = mapData(data, changesOf(tr.changes), (pos, assoc) => tr.changes.mapPos(pos, assoc));
        changed = true;
      }
      for (const e of tr.effects) {
        if (e.is(setAnnotations)) {
          data = e.value;
          changed = true;
        } else if (e.is(setAnnotationUi)) {
          ui = { ...ui, ...e.value };
          changed = true;
        }
      }
      if (!changed) return v;
      return {
        data,
        ui,
        decorations: build(tr.state.doc, data, ui, editable(), cb.onHandleKey),
      };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });

  const clicks = EditorView.domEventHandlers({
    mousedown(event) {
      const t = event.target as HTMLElement;
      const h = t.closest<HTMLElement>('[data-edge]');
      if (h && event.button === 0) {
        event.preventDefault();
        cb.onHandle(h.dataset['handleShot']!, h.dataset['edge'] as 'start' | 'end', event);
        return true;
      }
      const w = t.closest<HTMLElement>('[data-lineless]');
      if (w && event.button === 0) {
        event.preventDefault();
        cb.onSelect(w.dataset['shotId']!);
        return true;
      }
      return false;
    },
    contextmenu(event) {
      const w = (event.target as HTMLElement).closest<HTMLElement>('[data-lineless]');
      if (!w) return false;
      cb.onShotMenu(w.dataset['shotId']!, event);
      return true;
    },
  });

  return {
    extension: [field, clicks],
    data: (view) => view.state.field(field).data,
  };
}
