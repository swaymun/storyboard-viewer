/**
 * Animatic player: walks the timeline from `buildAnimatic` with a wall clock and drives one media
 * element per cue (trimmed with in/out, looped, faded, per-track gain/mute). Media elements are
 * used instead of decoding into Web Audio so long files stream and Range requests/Blob slices work.
 */
import { buildAnimatic, locate, type Animatic, type AnimaticCue } from '@storyboard-viewer/format';
import { setMediaSource } from './hls';
import { app } from './state.svelte';

const DRIFT = 0.25;

class Player {
  playing = $state(false);
  time = $state(0);
  /** Story time → shot/line under the playhead. */
  shotId = $state<string | null>(null);
  lineId = $state<string | null>(null);
  muted = $state.raw(new Set<string>());
  /** Solo'd tracks: when any, every other track is silent (preview only, not saved). */
  solo = $state.raw(new Set<string>());
  stageOpen = $state(false);
  durations = $state.raw(new Map<string, number>());

  animatic: Animatic = $derived.by(() => {
    const p = app.project;
    if (!p) return { duration: 0, shots: [], cues: [] };
    const known = this.durations;
    return buildAnimatic(p, { assetDuration: (id) => known.get(id) });
  });

  tracks = $derived.by(() => {
    const ids = new Set<string>();
    for (const t of app.project?.timeline.tracks ?? []) ids.add(t.id);
    for (const c of app.project?.timeline.cues ?? []) ids.add(c.track ?? 'default');
    const labels = new Map(
      (app.project?.timeline.tracks ?? []).map((t) => [t.id, t.label ?? t.id]),
    );
    return [...ids].map((id) => ({ id, label: labels.get(id) ?? id }));
  });

  private els = new Map<string, HTMLMediaElement>();
  private raf = 0;
  private wallStart = 0;
  private timeStart = 0;

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (!this.animatic.duration) return;
    if (this.time >= this.animatic.duration - 0.01) this.time = 0;
    this.wallStart = performance.now();
    this.timeStart = this.time;
    this.playing = true;
    this.tick();
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const el of this.els.values()) el.pause();
  }

  stop(): void {
    this.pause();
    this.seek(0);
  }

  seek(t: number): void {
    this.time = Math.max(0, Math.min(t, this.animatic.duration));
    this.wallStart = performance.now();
    this.timeStart = this.time;
    this.updatePosition();
    for (const el of this.els.values()) el.pause();
    if (this.playing) this.sync(true);
  }

  /** Jumps to the start of a shot (and optionally starts playing). */
  playShot(shotId: string): void {
    const s = this.animatic.shots.find((x) => x.id === shotId);
    if (!s) return;
    this.seek(s.start);
    if (!this.playing) this.play();
  }

  stepShot(delta: number): void {
    const shots = this.animatic.shots;
    const i = shots.findIndex((s) => s.id === this.shotId);
    const next = shots[Math.max(0, Math.min(shots.length - 1, (i < 0 ? 0 : i) + delta))];
    if (next) this.seek(next.start);
  }

  toggleTrack(id: string): void {
    const next = new Set(this.muted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.muted = next;
    if (this.playing) this.sync(false);
  }

  toggleSolo(id: string): void {
    const next = new Set(this.solo);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.solo = next;
    if (this.playing) this.sync(false);
  }

  /** Media elements created for cues (for tests/debugging). */
  debugMedia(): Array<{
    cue: string;
    paused: boolean;
    time: number;
    volume: number;
    muted: boolean;
  }> {
    return [...this.els.entries()].map(([key, el]) => ({
      cue: key.split('|')[0]!,
      paused: el.paused,
      time: el.currentTime,
      volume: el.volume,
      muted: el.muted,
    }));
  }

  /** Releases media elements (call when the project closes). */
  reset(): void {
    this.pause();
    for (const el of this.els.values()) el.removeAttribute('src');
    this.els.clear();
    this.time = 0;
    this.shotId = null;
    this.lineId = null;
  }

  private tick = (): void => {
    if (!this.playing) return;
    this.time = this.timeStart + (performance.now() - this.wallStart) / 1000;
    if (this.time >= this.animatic.duration) {
      this.time = this.animatic.duration;
      this.updatePosition();
      this.pause();
      return;
    }
    this.updatePosition();
    this.sync(false);
    this.raf = requestAnimationFrame(this.tick);
  };

  private updatePosition(): void {
    const { shot, line } = locate(this.animatic, this.time);
    this.shotId = shot?.id ?? null;
    this.lineId = line?.id ?? null;
  }

  private element(cue: AnimaticCue): HTMLMediaElement | null {
    const asset = app.assets.get(cue.asset);
    const url = asset ? app.mediaUrl(asset.src) : null;
    if (!url) return null;
    const key = `${cue.id}|${url}`;
    let el = this.els.get(key);
    if (!el) {
      el = new Audio();
      el.preload = 'auto';
      setMediaSource(el, url);
      el.addEventListener('loadedmetadata', () => {
        if (
          Number.isFinite(el!.duration) &&
          !this.durations.has(cue.asset) &&
          asset?.duration === undefined
        ) {
          this.durations = new Map(this.durations).set(cue.asset, el!.duration);
        }
      });
      this.els.set(key, el);
    }
    return el;
  }

  private sync(forceSeek: boolean): void {
    const t = this.time;
    const trackGain = new Map(
      (app.project?.timeline.tracks ?? []).map((tr) => [tr.id, tr.muted ? 0 : (tr.gain ?? 1)]),
    );
    const live = new Set<HTMLMediaElement>();
    for (const cue of this.animatic.cues) {
      if (t < cue.start || t >= cue.end) continue;
      let pos = cue.in + (t - cue.start);
      const out = cue.out ?? app.assets.get(cue.asset)?.duration ?? this.durations.get(cue.asset);
      if (out !== undefined) {
        const len = out - cue.in;
        if (cue.loop && len > 0) pos = cue.in + ((t - cue.start) % len);
        else if (pos >= out) continue;
      }
      const el = this.element(cue);
      if (!el) continue;
      live.add(el);
      let gain = cue.gain * (trackGain.get(cue.track) ?? 1);
      if (cue.fade_in > 0) gain *= Math.min(1, (t - cue.start) / cue.fade_in);
      if (cue.fade_out > 0) gain *= Math.min(1, (cue.end - t) / cue.fade_out);
      el.volume = Math.max(0, Math.min(1, gain));
      el.muted = this.muted.has(cue.track) || (this.solo.size > 0 && !this.solo.has(cue.track));
      if (el.paused || forceSeek || Math.abs(el.currentTime - pos) > DRIFT) {
        try {
          el.currentTime = pos;
        } catch {
          /* metadata not loaded yet */
        }
      }
      if (el.paused) void el.play().catch(() => {});
    }
    for (const el of this.els.values()) if (!live.has(el) && !el.paused) el.pause();
  }
}

export const player = new Player();

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
