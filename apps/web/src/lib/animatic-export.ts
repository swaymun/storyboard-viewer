/**
 * Animatic video export in the browser: shots (active variant, canvas compositions flattened)
 * rendered frame by frame on a canvas, timeline cues mixed with an OfflineAudioContext, optional
 * burned-in captions of the current line, encoded with WebCodecs and muxed by Mediabunny
 * (loaded on demand). MP4 (H.264 + AAC) when the browser can encode it, else WebM (VP9 + Opus).
 */
import {
  activeVariant,
  aspectValue,
  buildAnimatic,
  layerKind,
  locate,
  resolveLines,
  stripEmphasis,
  type Animatic,
  type Asset,
  type CanvasVariant,
  type SbdProject,
  type Shot,
} from '@storyboard-viewer/format';
import { drawText, loadTextFonts } from './text-render';
import { canvasSize, cssFilter } from './visual';

export interface AnimaticExportOptions {
  /** Long edge in pixels (720 → 1280×720 for 16:9, 720×1280 for 9:16). */
  height: 480 | 720 | 1080;
  fps: number;
  captions: boolean;
  audio: boolean;
}

export interface AnimaticExportResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  /** e.g. "H.264 + AAC". */
  codecs: string;
  duration: number;
  warnings: string[];
}

export interface ExportContext {
  project: SbdProject;
  /** URL for an asset `src` (null when not reachable). */
  url: (src: string) => string | null;
  onProgress?: (fraction: number, stage: string) => void;
  signal?: AbortSignal;
}

export function canExportVideo(): boolean {
  return (
    typeof window !== 'undefined' && 'VideoEncoder' in window && 'OfflineAudioContext' in window
  );
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output frame size for a project and a target "p" value (the short edge). */
export function frameSize(p: SbdProject, short: number): { width: number; height: number } {
  const a = aspectValue(p.manifest.aspect_ratio);
  return a >= 1
    ? { width: even(short * a), height: even(short) }
    : { width: even(short), height: even(short / a) };
}

function abortError(): Error {
  return new DOMException('Export cancelled', 'AbortError');
}

// --- media loading

type Visual = HTMLImageElement | HTMLVideoElement;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:/.test(url) && !url.startsWith(location.origin)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    if (/^https?:/.test(url) && !url.startsWith(location.origin)) v.crossOrigin = 'anonymous';
    v.addEventListener('loadeddata', () => resolve(v), { once: true });
    v.addEventListener('error', () => resolve(null), { once: true });
    v.src = url;
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.max(0, Math.min(t, (v.duration || 0) - 0.001));
  if (Math.abs(v.currentTime - target) < 0.001) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    v.addEventListener('seeked', done, { once: true });
    setTimeout(done, 2000);
    v.currentTime = target;
  });
}

/** Draws `src` into the box keeping its aspect ratio (letterboxed). */
function drawContain(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  w: number,
  h: number,
): void {
  if (!sw || !sh) return;
  const k = Math.min(w / sw, h / sh);
  const dw = sw * k;
  const dh = sh * k;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

const sizeOf = (v: Visual) =>
  v instanceof HTMLVideoElement
    ? { w: v.videoWidth, h: v.videoHeight }
    : { w: v.naturalWidth, h: v.naturalHeight };

// --- audio

async function decodeAudio(url: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function mixAudio(
  project: SbdProject,
  animatic: Animatic,
  buffers: Map<string, AudioBuffer>,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  const length = Math.ceil(animatic.duration * sampleRate);
  if (!length || !animatic.cues.length) return null;
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const tracks = new Map((project.timeline.tracks ?? []).map((t) => [t.id, t]));
  let any = false;
  for (const cue of animatic.cues) {
    const buf = buffers.get(cue.asset);
    const track = tracks.get(cue.track);
    if (!buf || track?.muted) continue;
    const end = Math.min(cue.end, animatic.duration);
    if (end <= cue.start) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const level = cue.gain * (track?.gain ?? 1);
    const g = gain.gain;
    if (cue.fade_in > 0) {
      g.setValueAtTime(0, cue.start);
      g.linearRampToValueAtTime(level, cue.start + cue.fade_in);
    } else g.setValueAtTime(level, cue.start);
    if (cue.fade_out > 0 && end - cue.fade_out > cue.start) {
      g.setValueAtTime(level, end - cue.fade_out);
      g.linearRampToValueAtTime(0, end);
    }
    src.connect(gain).connect(ctx.destination);
    const out = Math.min(cue.out ?? buf.duration, buf.duration);
    if (cue.loop && out > cue.in) {
      src.loop = true;
      src.loopStart = cue.in;
      src.loopEnd = out;
      src.start(cue.start, cue.in);
    } else {
      src.start(cue.start, cue.in, Math.max(0, out - cue.in));
    }
    src.stop(end);
    any = true;
  }
  return any ? ctx.startRendering() : null;
}

// --- frames

async function renderCanvasVariant(
  v: CanvasVariant,
  project: SbdProject,
  assets: Map<string, Asset>,
  visual: (asset: Asset) => Promise<Visual | null>,
  fontUrl: (src: string) => string | null,
): Promise<OffscreenCanvas> {
  const size = canvasSize(v, project.manifest);
  const c = new OffscreenCanvas(Math.round(size.width), Math.round(size.height));
  const ctx = c.getContext('2d')!;
  if (v.background) {
    ctx.fillStyle = v.background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  await loadTextFonts(v.layers, assets, fontUrl);
  for (const l of v.layers) {
    if (l.visible === false) continue;
    const kind = layerKind(l);
    if (kind === 'text') {
      ctx.save();
      ctx.translate(l.x ?? 0, l.y ?? 0);
      ctx.rotate(((l.rotation ?? 0) * Math.PI) / 180);
      ctx.scale(l.scale_x ?? 1, l.scale_y ?? 1);
      ctx.globalAlpha = l.opacity ?? 1;
      drawText(ctx, l);
      ctx.restore();
      continue;
    }
    if (kind !== 'image' || !l.asset) continue; // empty layout slots are not part of the frame
    const asset = assets.get(l.asset);
    const el = asset ? await visual(asset) : null;
    if (!asset || !el) continue;
    const natural = sizeOf(el);
    const crop = l.crop ?? { x: 0, y: 0, width: natural.w, height: natural.h };
    const w = l.width ?? crop.width;
    const h = l.height ?? crop.height;
    ctx.save();
    ctx.translate(l.x ?? 0, l.y ?? 0);
    ctx.rotate(((l.rotation ?? 0) * Math.PI) / 180);
    ctx.scale(l.scale_x ?? 1, l.scale_y ?? 1);
    ctx.globalAlpha = l.opacity ?? 1;
    const filter = cssFilter(l.filters);
    if (filter !== 'none') ctx.filter = filter;
    // Source rectangle in the element's own pixels (asset width/height may differ from natural).
    const kx = asset.width ? natural.w / asset.width : 1;
    const ky = asset.height ? natural.h / asset.height : 1;
    ctx.drawImage(el, crop.x * kx, crop.y * ky, crop.width * kx, crop.height * ky, 0, 0, w, h);
    ctx.restore();
  }
  return c;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, w: number, h: number): void {
  const size = Math.round(Math.min(w, h) * 0.05);
  ctx.font = `600 ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrap(ctx, text, w * 0.84).slice(-3);
  const lh = size * 1.3;
  const pad = size * 0.45;
  const bottom = h - h * (w < h ? 0.16 : 0.07);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxH = lines.length * lh + pad * 2;
  ctx.fillStyle = 'rgb(0 0 0 / 0.62)';
  ctx.beginPath();
  ctx.roundRect(w / 2 - widest / 2 - pad * 1.5, bottom - boxH, widest + pad * 3, boxH, size * 0.3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, bottom - boxH + pad + lh * (i + 0.5)));
}

interface CaptionLine {
  text: string;
  type?: string;
  character?: string;
}

/** Caption for a line: dialogue gets its speaker ("MAYA: We're late."); headings are skipped. */
function captionText(l: CaptionLine | undefined): string | null {
  if (!l || ['scene_heading', 'transition', 'parenthetical'].includes(l.type ?? '')) return null;
  const text = stripEmphasis(l.text);
  return l.character && l.type === 'dialogue' ? `${l.character}: ${text}` : text;
}

export async function exportAnimatic(
  ctxIn: ExportContext,
  opts: AnimaticExportOptions,
): Promise<AnimaticExportResult> {
  const { project, url, signal } = ctxIn;
  const progress = ctxIn.onProgress ?? (() => {});
  const warnings: string[] = [];
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  if (!canExportVideo()) throw new Error('This browser cannot encode video (WebCodecs missing).');

  const mb = await import('mediabunny');
  check();
  const assets = new Map(project.assets.assets.map((a) => [a.id, a]));

  // 1. Audio: decode every cue's media once; their lengths also feed the timing.
  progress(0, 'Loading audio');
  const sampleRate = 48000;
  const buffers = new Map<string, AudioBuffer>();
  const decodeCtx = new OfflineAudioContext(2, 1, sampleRate);
  const cueAssets = [...new Set(project.timeline.cues.map((c) => c.asset))];
  for (const id of cueAssets) {
    check();
    const a = assets.get(id);
    const u = a ? url(a.src) : null;
    const buf = u ? await decodeAudio(u, decodeCtx) : null;
    if (buf) buffers.set(id, buf);
    else if (opts.audio) warnings.push(`Could not decode audio of ${a?.name ?? id}`);
  }
  const animatic = buildAnimatic(project, {
    assetDuration: (id) => assets.get(id)?.duration ?? buffers.get(id)?.duration,
  });
  if (animatic.duration <= 0) throw new Error('The storyboard has no shots to export.');
  progress(0.03, 'Mixing audio');
  const mixed = opts.audio ? await mixAudio(project, animatic, buffers, sampleRate) : null;
  check();

  // 2. Encoder setup: MP4 (H.264 + AAC) if possible, else WebM (VP9/VP8 + Opus).
  const { width, height } = frameSize(project, opts.height);
  const enc = { width, height, quality: mb.QUALITY_HIGH };
  let format: InstanceType<typeof mb.Mp4OutputFormat> | InstanceType<typeof mb.WebMOutputFormat>;
  let ext: 'mp4' | 'webm';
  let videoCodec = await mb.getFirstEncodableVideoCodec(['avc'], enc);
  let audioCodec = mixed ? await mb.getFirstEncodableAudioCodec(['aac'], { sampleRate }) : null;
  if (videoCodec && (!mixed || audioCodec)) {
    format = new mb.Mp4OutputFormat({ fastStart: 'in-memory' });
    ext = 'mp4';
  } else {
    videoCodec = await mb.getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], enc);
    audioCodec = mixed ? await mb.getFirstEncodableAudioCodec(['opus'], { sampleRate }) : null;
    format = new mb.WebMOutputFormat();
    ext = 'webm';
  }
  if (!videoCodec) throw new Error('This browser cannot encode H.264, VP9 or VP8 video.');
  if (mixed && !audioCodec) warnings.push('This browser cannot encode audio; the video is silent.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const output = new mb.Output({ format, target: new mb.BufferTarget() });
  const videoSource = new mb.CanvasSource(canvas, {
    codec: videoCodec,
    quality: mb.QUALITY_HIGH,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: opts.fps });
  const audioSource =
    mixed && audioCodec
      ? new mb.AudioBufferSource({ codec: audioCodec, quality: mb.QUALITY_HIGH })
      : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  try {
    // 3. Visuals per shot: still images/compositions are rendered once, videos per frame.
    const visuals = new Map<string, Promise<Visual | null>>();
    const visual = (asset: Asset): Promise<Visual | null> => {
      let p = visuals.get(asset.id);
      if (!p) {
        const u = url(asset.src);
        p = !u ? Promise.resolve(null) : asset.kind === 'video' ? loadVideo(u) : loadImage(u);
        visuals.set(asset.id, p);
      }
      return p;
    };
    const stills = new Map<string, CanvasImageSource | null>();
    const shotVideo = new Map<string, HTMLVideoElement | null>();
    async function prepareShot(shot: Shot): Promise<void> {
      if (stills.has(shot.id) || shotVideo.has(shot.id)) return;
      const v = activeVariant(shot);
      if (v?.type === 'image') {
        const a = assets.get(v.asset);
        const el = a ? await visual(a) : null;
        if (el instanceof HTMLVideoElement) shotVideo.set(shot.id, el);
        else stills.set(shot.id, el);
        if (!el) warnings.push(`Shot ${shot.title ?? shot.id}: image not available`);
      } else if (v?.type === 'canvas') {
        stills.set(shot.id, await renderCanvasVariant(v, project, assets, visual, url));
      } else stills.set(shot.id, null);
    }

    const resolved = new Map<string, CaptionLine>();
    for (const [id, l] of resolveLines(project)) {
      const r: CaptionLine = { text: l.text };
      if (l.type) r.type = l.type;
      if (l.element?.character) r.character = l.element.character;
      resolved.set(id, r);
    }

    const frames = Math.max(1, Math.ceil(animatic.duration * opts.fps));
    for (let i = 0; i < frames; i++) {
      check();
      const t = i / opts.fps;
      const { shot: as, line } = locate(animatic, t);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      const shot = as ? project.shots[as.id] : undefined;
      if (shot) {
        await prepareShot(shot);
        const vid = shotVideo.get(shot.id);
        if (vid) {
          const local = t - as!.start;
          await seek(vid, vid.duration ? local % vid.duration : 0);
          drawContain(ctx, vid, vid.videoWidth, vid.videoHeight, width, height);
        } else {
          const still = stills.get(shot.id);
          if (still) {
            const sw =
              still instanceof HTMLImageElement
                ? still.naturalWidth
                : (still as OffscreenCanvas).width;
            const sh =
              still instanceof HTMLImageElement
                ? still.naturalHeight
                : (still as OffscreenCanvas).height;
            drawContain(ctx, still, sw, sh, width, height);
          }
        }
      }
      if (opts.captions && line) {
        const text = captionText(resolved.get(line.id));
        if (text) drawCaption(ctx, text, width, height);
      }
      await videoSource.add(t, 1 / opts.fps);
      if (i % 5 === 0) progress(0.05 + 0.9 * (i / frames), 'Rendering frames');
    }
    videoSource.close();
    if (audioSource && mixed) {
      progress(0.96, 'Encoding audio');
      await audioSource.add(mixed);
      audioSource.close();
    }
    check();
    progress(0.98, 'Finishing');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  const buf = output.target.buffer!;
  const names: Record<string, string> = {
    avc: 'H.264',
    vp9: 'VP9',
    vp8: 'VP8',
    av1: 'AV1',
    aac: 'AAC',
    opus: 'Opus',
  };
  progress(1, 'Done');
  return {
    blob: new Blob([buf], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }),
    ext,
    codecs: [videoCodec, audioSource ? audioCodec : null]
      .filter(Boolean)
      .map((c) => names[c!] ?? c)
      .join(' + '),
    duration: animatic.duration,
    warnings,
  };
}
