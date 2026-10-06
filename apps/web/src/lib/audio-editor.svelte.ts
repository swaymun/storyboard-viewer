/**
 * Audio editing shared by the shots' Audio sections and the Soundtrack panel (the former Timeline
 * tab). One source file at a time is shown as a waveform; a segment is marked (I / O, typed, or
 * dragged on the waveform) and assigned to the selected line (A), which then selects the next
 * line in story order with the next segment starting where this one ended, so a whole take can
 * be split across lines quickly, even across shots. A selected cue drives the source and the
 * marks; trimming it saves at once.
 *
 * The state lives here (not in a component) so it survives the active shot card changing while
 * the workflow walks from one shot into the next.
 */
import {
  addCue,
  isGlobalTarget,
  isLineTarget,
  isRangeTarget,
  isShotTarget,
  removeCue,
  stripEmphasis,
  updateCue,
  type Asset,
  type Cue,
  type CueTarget,
} from '@storyboard-viewer/format';
import { formatTime, player } from './player.svelte';
import { app } from './state.svelte';

const round = (t: number) => Math.round(t * 1000) / 1000;

export function defaultTrack(a: Asset | undefined): string {
  const c = (a?.category ?? '').toLowerCase();
  if (c.includes('music')) return 'music';
  if (c.includes('sfx') || c.includes('effect')) return 'sfx';
  if (a?.kind === 'video') return 'video';
  return 'dialogue';
}

export function lineLabel(id: string, max = 40): string {
  const l = app.lines.get(id);
  if (!l) return id;
  const text = stripEmphasis(l.text);
  const who = l.element?.character ? `${l.element.character}: ` : '';
  const s = who + text;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function shotLabel(id: string): string {
  const e = app.shots.find((s) => s.ref.id === id);
  return e ? `Shot ${e.index + 1}${e.shot.title ? `: ${e.shot.title}` : ''}` : id;
}

export function targetLabel(t: CueTarget, max = 28): string {
  if (isLineTarget(t)) return lineLabel(t.line, max);
  if (isShotTarget(t)) return shotLabel(t.shot);
  if (isRangeTarget(t))
    return `${lineLabel(t.range[0], max / 2)} → ${lineLabel(t.range[1], max / 2)}`;
  if (isGlobalTarget(t)) return `Whole story from ${formatTime(t.global.start ?? 0)}`;
  return '?';
}

export function cueName(c: Cue): string {
  return c.label ?? app.assets.get(c.asset)?.name ?? c.asset;
}

class AudioEditor {
  sourceId = $state<string | null>(null);
  selectedCue = $state<string | null>(null);
  markIn = $state<number | null>(null);
  markOut = $state<number | null>(null);
  playhead = $state(0);
  previewing = $state(false);
  zoom = $state(1);
  /** Which place edits audio now: a shot's Audio section or the Soundtrack panel. */
  scope = $state<'shot' | 'story'>('shot');
  /** Audio sections of shot cards expanded (remembered while switching shots). */
  sectionOpen = $state(false);
  /** A line button that should take focus once it is rendered (auto-advance). */
  focusLine = $state<string | null>(null);

  cues = $derived(app.project?.timeline.cues ?? []);
  cue = $derived<Cue | undefined>(this.cues.find((c) => c.id === this.selectedCue));
  mediaAssets = $derived(
    (app.project?.assets.assets ?? []).filter((a) => a.kind === 'audio' || a.kind === 'video'),
  );
  source = $derived<Asset | undefined>(this.sourceId ? app.assets.get(this.sourceId) : undefined);
  sourceUrl = $derived(this.source ? app.mediaUrl(this.source.src) : null);
  sourceDuration = $derived(
    this.source?.duration ?? player.durations.get(this.sourceId ?? '') ?? 0,
  );
  /** Cues by line ID (line targets only). */
  cuesByLine = $derived.by(() => {
    const m = new Map<string, Cue[]>();
    for (const c of this.cues)
      if (isLineTarget(c.target)) m.set(c.target.line, [...(m.get(c.target.line) ?? []), c]);
    return m;
  });
  /** All lines in story order: shots in order, then lines not in a shot. */
  storyLines = $derived.by(() => {
    const p = app.project;
    if (!p) return [];
    const inShots = p.ids.shots.flatMap((s) => s.lines);
    const used = new Set(inShots);
    return [...inShots, ...p.ids.lines.filter((l) => !used.has(l.id)).map((l) => l.id)];
  });
  trackNames = $derived([
    ...new Set(['dialogue', 'music', 'sfx', 'video', ...player.tracks.map((t) => t.id)]),
  ]);

  private audio: HTMLAudioElement | null = null;
  private raf = 0;
  private stopAt = Infinity;

  /** The file most line cues use, else the first audio asset. */
  defaultSource(): string | null {
    const counts = new Map<string, number>();
    for (const c of this.cues)
      if (isLineTarget(c.target)) counts.set(c.asset, (counts.get(c.asset) ?? 0) + 1);
    const best = [...counts].toSorted((a, b) => b[1] - a[1])[0]?.[0];
    return (
      best ??
      this.mediaAssets.find((a) => a.kind === 'audio')?.id ??
      this.mediaAssets[0]?.id ??
      null
    );
  }

  ensureSource(): void {
    if (this.sourceId && app.assets.has(this.sourceId)) return;
    this.setSource(this.defaultSource());
  }

  setSource(id: string | null): void {
    if (id === this.sourceId) return;
    this.stopPreview();
    this.sourceId = id;
    if (this.cue && this.cue.asset !== id) this.selectedCue = null;
  }

  selectCue(id: string | null, scope?: 'shot' | 'story'): void {
    if (scope) this.scope = scope;
    this.selectedCue = id;
    const c = this.cues.find((x) => x.id === id);
    if (!c) return;
    this.setSource(c.asset);
    this.selectedCue = id;
    this.markIn = c.in ?? 0;
    this.markOut = c.out ?? (app.assets.get(c.asset)?.duration || null);
    this.playhead = c.in ?? 0;
  }

  /** Selects a line (and its shot) and its cue from the current source, if any. */
  pickLine(id: string): void {
    this.scope = 'shot';
    app.selectLine(id, { withShot: true });
    const list = this.cuesByLine.get(id) ?? [];
    const c = list.find((x) => x.asset === this.sourceId) ?? list[0];
    if (c) this.selectCue(c.id);
    else this.selectedCue = null;
  }

  /** ↑/↓ in a line list: the neighbouring line in story order. */
  stepLine(delta: number): string | null {
    const lines = this.storyLines;
    const i = app.selectedLine ? lines.indexOf(app.selectedLine) : -1;
    const next = lines[Math.max(0, Math.min(lines.length - 1, i + delta))];
    if (!next || next === app.selectedLine) return null;
    this.pickLine(next);
    this.focusLine = next;
    return next;
  }

  setRange(i: number, o: number, final: boolean): void {
    this.markIn = round(i);
    this.markOut = round(o);
    if (final && this.selectedCue && app.canEdit) {
      const id = this.selectedCue;
      const [a, b] = [this.markIn, this.markOut];
      app.edit('Trim cue', (p) => updateCue(p, id, { in: a, out: b }));
    }
  }

  setMark(which: 'in' | 'out', v: number | null): void {
    if (which === 'in') this.markIn = v;
    else this.markOut = v;
    if (this.selectedCue && this.markIn !== null && this.markOut !== null)
      if (this.markOut > this.markIn) this.setRange(this.markIn, this.markOut, true);
  }

  /** I / O: marks in or out at the playhead. */
  mark(which: 'in' | 'out'): void {
    const t = round(this.playhead);
    if (which === 'in') {
      this.markIn = t;
      if (this.markOut !== null && this.markOut <= t) this.markOut = null;
    } else {
      if (this.markIn === null || t <= this.markIn) {
        app.toast('Mark the in point first (I), then the out point after it', { kind: 'info' });
        return;
      }
      this.markOut = t;
    }
    if (this.selectedCue && this.markIn !== null && this.markOut !== null)
      this.setRange(this.markIn, this.markOut, true);
  }

  /** A: the marked segment becomes the selected line's audio; then on to the next line. */
  assign(): void {
    const line = app.selectedLine;
    const source = this.source;
    if (!line) return app.toast('Select a line first', { kind: 'info' });
    if (!source) return app.toast('Choose a source file first', { kind: 'info' });
    if (this.markIn === null || this.markOut === null || this.markOut <= this.markIn)
      return app.toast('Mark in and out first (I and O, or drag on the waveform)', {
        kind: 'info',
      });
    const [i, o] = [this.markIn, this.markOut];
    const existing = this.cuesByLine.get(line)?.find((c) => c.asset === source.id);
    const ok = app.edit(existing ? 'Re-time line audio' : 'Assign audio to line', (p) =>
      existing
        ? updateCue(p, existing.id, { in: i, out: o })
        : addCue(p, {
            asset: source.id,
            in: i,
            out: o,
            target: { line },
            track: defaultTrack(source),
            label: `${stripEmphasis(app.lines.get(line)?.text ?? '').slice(0, 24)}…`,
          }),
    );
    if (!ok) return;
    // Advance: next line (possibly in the next shot); its segment starts where this one ended.
    const next = this.storyLines[this.storyLines.indexOf(line) + 1];
    this.selectedCue = null;
    this.markIn = o;
    this.markOut = null;
    this.playhead = o;
    if (next) {
      app.selectLine(next, { withShot: true });
      this.focusLine = next;
    }
  }

  /** Adds the marked segment (or the whole file) as a cue on a shot or the whole story. */
  addSegment(target: CueTarget, scope: 'shot' | 'story'): void {
    const source = this.source;
    if (!source) return;
    const seg =
      this.markIn !== null && this.markOut !== null && this.markOut > this.markIn
        ? { in: this.markIn, out: this.markOut }
        : {};
    let id = '';
    if (
      app.edit('Add cue', (p) => {
        const r = addCue(p, {
          asset: source.id,
          ...seg,
          target,
          track: defaultTrack(source),
          ...(isGlobalTarget(target) && defaultTrack(source) === 'music'
            ? { loop: true, gain: 0.5 }
            : {}),
        });
        id = r.id;
        return r;
      })
    )
      this.selectCue(id, scope);
  }

  /** Adds a whole file as a cue (asset picker → line, shot or story). */
  addCueFrom(assetId: string, target: CueTarget, scope: 'shot' | 'story'): void {
    const a = app.assets.get(assetId);
    let id = '';
    if (
      app.edit('Add cue', (p) => {
        const r = addCue(p, { asset: assetId, target, track: defaultTrack(a) });
        id = r.id;
        return r;
      })
    )
      this.selectCue(id, scope);
  }

  patchCue(label: string, patch: Record<string, unknown>, key?: string): void {
    if (!this.selectedCue) return;
    const id = this.selectedCue;
    app.edit(
      label,
      (p) => updateCue(p, id, patch as Partial<Cue>),
      key ? { coalesce: `${id}:${key}` } : {},
    );
  }

  deleteCue(): void {
    if (!this.selectedCue) return;
    const id = this.selectedCue;
    if (app.edit('Delete cue', (p) => removeCue(p, id))) this.selectedCue = null;
  }

  clear(): void {
    this.selectedCue = null;
    this.markIn = null;
    this.markOut = null;
  }

  // --- source preview (P)

  stopPreview(): void {
    this.previewing = false;
    cancelAnimationFrame(this.raf);
    this.audio?.pause();
  }

  preview(fromSelection = true): void {
    if (this.previewing) {
      this.stopPreview();
      return;
    }
    const url = this.sourceUrl;
    if (!url) return;
    if (player.playing) player.pause();
    this.audio ??= new Audio();
    const a = this.audio;
    if (a.src !== new URL(url, location.href).href) a.src = url;
    const sel = fromSelection && this.markIn !== null && this.markOut !== null;
    const start = sel ? this.markIn! : this.playhead;
    this.stopAt = sel ? this.markOut! : Infinity;
    a.currentTime = start;
    this.playhead = start;
    this.previewing = true;
    void a.play().catch(() => (this.previewing = false));
    const loop = () => {
      if (!this.previewing) return;
      this.playhead = a.currentTime;
      if (a.currentTime >= this.stopAt || a.ended) {
        this.stopPreview();
        this.playhead = Math.min(this.playhead, this.stopAt);
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  seek(t: number): void {
    this.playhead = round(t);
    if (this.previewing) {
      this.stopPreview();
      this.preview(false);
    }
  }

  /**
   * Keys of the audio editors (only while focus is inside one): I / O mark, P plays, A assigns,
   * ↑/↓ change line, Delete removes the selected cue, Esc clears. Returns true when handled.
   */
  onKey(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return false;
    const k = e.key.toLowerCase();
    if (k === 'i') this.mark('in');
    else if (k === 'o') this.mark('out');
    else if (k === 'p') this.preview(true);
    else if (k === 'a' && app.canEdit) this.assign();
    else if ((k === 'arrowdown' || k === 'arrowup') && t.closest('[data-audio-lines]'))
      this.stepLine(k === 'arrowdown' ? 1 : -1);
    else if ((k === 'delete' || k === 'backspace') && this.selectedCue && app.canEdit)
      this.deleteCue();
    else if (k === 'escape' && (this.selectedCue || this.markIn !== null)) this.clear();
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }
}

export const audio = new AudioEditor();
