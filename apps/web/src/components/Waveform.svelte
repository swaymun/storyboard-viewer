<script lang="ts">
  import { theme } from '../lib/theme.svelte';
  // Waveform of one audio/video asset with cue regions, an in/out selection with draggable
  // handles and a playhead. Drag on empty space to select a segment, drag a handle to trim, click
  // a region to pick its cue, click to move the playhead.
  import { loadPeaks, type Peaks } from '../lib/waveform';

  export interface Region {
    id: string;
    in: number;
    out: number;
    label: string;
  }

  let {
    url,
    fallbackDuration = 0,
    regions,
    activeRegion = null,
    markIn = null,
    markOut = null,
    playhead = 0,
    zoom = 1,
    height: HEIGHT = 120,
    onSelectRegion,
    onRange,
    onSeek,
  }: {
    url: string | null;
    fallbackDuration?: number;
    regions: Region[];
    activeRegion?: string | null;
    markIn?: number | null;
    markOut?: number | null;
    playhead?: number;
    zoom?: number;
    /** Canvas height in CSS pixels. */
    height?: number;
    onSelectRegion: (id: string | null) => void;
    /** Selection changed; `final` on pointer up. */
    onRange: (inT: number, outT: number, final: boolean) => void;
    onSeek: (t: number) => void;
  } = $props();

  let peaks = $state.raw<Peaks | null>(null);
  let error = $state('');
  let scroller = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let viewWidth = $state(600);

  const duration = $derived(peaks?.duration || fallbackDuration || 1);
  const width = $derived(Math.max(viewWidth, Math.round(viewWidth * zoom)));
  const pps = $derived(width / duration);

  $effect(() => {
    const u = url;
    peaks = null;
    error = '';
    if (!u) return;
    let alive = true;
    loadPeaks(u)
      .then((p) => alive && (peaks = p))
      .catch((e: Error) => alive && (error = e.message));
    return () => {
      alive = false;
    };
  });

  $effect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => (viewWidth = scroller!.clientWidth));
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  function cssVar(name: string): string {
    return theme.token(name, 'gray');
  }

  // Draw (again when the theme changes)
  $effect(() => {
    void theme.resolved;
    const c = canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(HEIGHT * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${HEIGHT}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const accent = cssVar('--accent');
    const fg = cssVar('--fg-muted');
    const faint = cssVar('--border-strong');
    // regions
    for (const r of regions) {
      const x0 = r.in * pps;
      const x1 = r.out * pps;
      g.globalAlpha = r.id === activeRegion ? 0.28 : 0.12;
      g.fillStyle = accent;
      g.fillRect(x0, 0, x1 - x0, HEIGHT);
      g.globalAlpha = 0.9;
      g.fillStyle = fg;
      g.font = '11px system-ui, sans-serif';
      g.save();
      g.beginPath();
      g.rect(x0, 0, x1 - x0, HEIGHT);
      g.clip();
      g.fillText(r.label, x0 + 4, 13);
      g.restore();
    }
    g.globalAlpha = 1;
    // waveform
    const mid = HEIGHT > 80 ? HEIGHT / 2 + 6 : HEIGHT / 2 + 4;
    const amp = HEIGHT > 80 ? HEIGHT / 2 - 12 : HEIGHT / 2 - 8;
    if (peaks) {
      g.fillStyle = fg;
      const step = 1;
      for (let x = 0; x < width; x += step) {
        const t0 = x / pps;
        const t1 = (x + step) / pps;
        let m = 0;
        for (let b = Math.floor(t0 * peaks.rate); b < Math.ceil(t1 * peaks.rate); b++) {
          const v = peaks.data[b] ?? 0;
          if (v > m) m = v;
        }
        const h = Math.max(1, m * amp);
        g.fillRect(x, mid - h, Math.max(1, step - 0.2), h * 2);
      }
    } else {
      g.fillStyle = faint;
      g.fillRect(0, mid, width, 1);
    }
    // selection
    if (markIn !== null) {
      const x0 = markIn * pps;
      const x1 = markOut !== null ? markOut * pps : x0;
      if (markOut !== null) {
        g.globalAlpha = 0.18;
        g.fillStyle = accent;
        g.fillRect(x0, 0, x1 - x0, HEIGHT);
        g.globalAlpha = 1;
      }
      g.fillStyle = accent;
      g.fillRect(x0 - 1, 0, 2, HEIGHT);
      g.fillRect(x0 - 1, 0, 8, 10);
      if (markOut !== null) {
        g.fillRect(x1 - 1, 0, 2, HEIGHT);
        g.fillRect(x1 - 7, HEIGHT - 10, 8, 10);
      }
    }
    // playhead
    g.fillStyle = cssVar('--fg');
    g.fillRect(playhead * pps - 0.5, 0, 1, HEIGHT);
  });

  // Keep the playhead in view while playing.
  $effect(() => {
    if (!scroller || zoom <= 1) return;
    const x = playhead * pps;
    if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 20)
      scroller.scrollLeft = Math.max(0, x - 40);
  });

  type Drag = { mode: 'in' | 'out' | 'new'; start: number; moved: boolean };
  let drag: Drag | null = null;

  const timeAt = (e: PointerEvent) => {
    const r = canvas!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (e.clientX - r.left) / pps));
  };

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    const t = timeAt(e);
    const near = (v: number | null) => v !== null && Math.abs(v * pps - t * pps) <= 6;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (near(markIn) && markOut !== null) drag = { mode: 'in', start: t, moved: false };
    else if (near(markOut)) drag = { mode: 'out', start: t, moved: false };
    else drag = { mode: 'new', start: t, moved: false };
  }

  function move(e: PointerEvent) {
    const t = timeAt(e);
    if (!drag) {
      const near = (v: number | null) => v !== null && Math.abs(v - t) * pps <= 6;
      (e.currentTarget as HTMLElement).style.cursor =
        near(markIn) || near(markOut) ? 'ew-resize' : 'crosshair';
      return;
    }
    if (Math.abs(t - drag.start) * pps > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === 'in' && markOut !== null)
      onRange(Math.min(t, markOut - 0.01), markOut, false);
    else if (drag.mode === 'out' && markIn !== null)
      onRange(markIn, Math.max(t, markIn + 0.01), false);
    else if (drag.mode === 'new') {
      if (activeRegion) onSelectRegion(null);
      onRange(Math.min(drag.start, t), Math.max(drag.start, t), false);
    }
  }

  function up(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d) return;
    const t = timeAt(e);
    if (!d.moved) {
      const hit = regions.find((r) => t >= r.in && t <= r.out);
      if (d.mode === 'new' && hit && hit.id !== activeRegion) onSelectRegion(hit.id);
      onSeek(t);
      return;
    }
    if (markIn !== null && markOut !== null) onRange(markIn, markOut, true);
  }
</script>

<!-- Focusable (not in the tab order) so clicking the waveform keeps keyboard focus inside the
     audio editor: I / O / P / A keep working after you click to move the playhead. -->
<div class="wave" bind:this={scroller} tabindex="-1" data-waveform>
  <canvas
    bind:this={canvas}
    aria-hidden="true"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (drag = null)}
  ></canvas>
  {#if error}<p class="msg">{error}</p>{:else if !peaks && url}<p class="msg">
      Loading waveform…
    </p>{/if}
</div>

<style>
  .wave {
    outline: none;
    position: relative;
    overflow-x: auto;
    overflow-y: hidden;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  canvas {
    display: block;
    touch-action: none;
  }
  .msg {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    font-size: 12px;
    color: var(--fg-muted);
    pointer-events: none;
  }
</style>
