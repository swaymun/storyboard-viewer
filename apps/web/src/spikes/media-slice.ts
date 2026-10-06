/**
 * M0 spike (dev only, not part of the production build): verify that media STOREd in a packed
 * .sbd can be played straight from `blob.slice()` in <audio>/<video>, including seeking.
 * Open /spikes/media-slice.html with `pnpm dev` and press "Run spike".
 */
import {
  blobSource,
  entryBlob,
  packSbd,
  readZipIndex,
  SBD_MIMETYPE,
  type SbdTree,
  type ZipEntry,
} from '@storyboard-viewer/format';

const logEl = document.getElementById('log')!;
const resultEl = document.getElementById('result')!;
const players = document.getElementById('players')!;
const fileInput = document.getElementById('file') as HTMLInputElement;

function log(msg: string) {
  logEl.textContent += `${msg}\n`;
}

function makeWav(seconds = 2, rate = 22050, freq = 440): Uint8Array {
  const n = Math.round(seconds * rate);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 8000, true);
  return new Uint8Array(v.buffer);
}

/** Records ~1.5 s of an animated canvas with MediaRecorder (MP4 if supported, else WebM). */
async function recordVideo(): Promise<{ bytes: Uint8Array; ext: string } | null> {
  if (typeof MediaRecorder === 'undefined') return null;
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(
    (t) => MediaRecorder.isTypeSupported(t),
  );
  if (!type) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: type });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(100);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      ctx.fillStyle = `hsl(${(t * 240) % 360} 70% 50%)`;
      ctx.fillRect(0, 0, 160, 90);
      ctx.fillStyle = '#fff';
      ctx.font = '20px sans-serif';
      ctx.fillText(`t=${t.toFixed(2)}`, 20, 50);
      if (t < 1.5) requestAnimationFrame(frame);
      else resolve();
    };
    frame();
  });
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    ext: type.startsWith('video/mp4') ? 'mp4' : 'webm',
  };
}

function once(el: HTMLMediaElement, ok: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${ok}`)), timeoutMs);
    el.addEventListener(ok, () => (clearTimeout(timer), resolve()), { once: true });
    el.addEventListener(
      'error',
      () => (
        clearTimeout(timer),
        reject(new Error(`media error ${el.error?.code}: ${el.error?.message}`))
      ),
      { once: true },
    );
  });
}

interface Check {
  name: string;
  type: string;
  bytes: number;
  range: [number, number];
  duration?: number;
  played?: boolean;
  seeked?: boolean;
  error?: string;
}

async function checkEntry(blob: Blob, entry: ZipEntry): Promise<Check> {
  const slice = entryBlob(blob, entry);
  const check: Check = {
    name: entry.name,
    type: slice.type,
    bytes: slice.size,
    range: [entry.dataStart, entry.dataEnd],
  };
  const el = document.createElement(slice.type.startsWith('video') ? 'video' : 'audio');
  el.controls = true;
  el.muted = true; // allow autoplay without a user gesture
  el.preload = 'auto';
  el.src = URL.createObjectURL(slice);
  el.setAttribute('aria-label', entry.name);
  const label = document.createElement('p');
  label.textContent = `${entry.name} — bytes ${entry.dataStart}..${entry.dataEnd} of the packed file`;
  players.append(label, el);
  try {
    await once(el, 'loadedmetadata');
    check.duration = el.duration;
    await el.play();
    await once(el, 'timeupdate');
    check.played = el.currentTime > 0 || !el.paused;
    el.pause();
    const target = Number.isFinite(el.duration) ? el.duration / 2 : 0.5;
    const seeked = once(el, 'seeked');
    el.currentTime = target;
    await seeked;
    check.seeked = Math.abs(el.currentTime - target) < 0.25;
  } catch (e) {
    check.error = String(e);
  }
  return check;
}

async function runSpike() {
  logEl.textContent = '';
  players.textContent = '';
  resultEl.dataset.status = 'running';
  resultEl.textContent = '';
  try {
    const enc = new TextEncoder();
    const tree: SbdTree = {
      'manifest.json': enc.encode(JSON.stringify({ format_version: '0.1.0', title: 'Spike' })),
      'media/tone.wav': makeWav(),
    };
    const video = await recordVideo();
    if (video) tree[`media/clip.${video.ext}`] = video.bytes;
    else log('MediaRecorder unavailable: skipping generated video');
    const extra = fileInput.files?.[0];
    if (extra)
      tree[`media/user-${extra.name.replace(/[^\w.-]/g, '_')}`] = new Uint8Array(
        await extra.arrayBuffer(),
      );

    const packed = new Blob([packSbd(tree) as BlobPart], { type: SBD_MIMETYPE });
    log(`packed .sbd: ${packed.size} bytes`);
    const index = await readZipIndex(blobSource(packed));
    for (const e of index)
      log(`  ${e.name}  method=${e.method}  data=[${e.dataStart}, ${e.dataEnd})`);

    const checks: Check[] = [];
    for (const e of index.filter((x) => x.name.startsWith('media/') && x.method === 0)) {
      checks.push(await checkEntry(packed, e));
    }
    const ok = checks.length > 0 && checks.every((c) => c.played && c.seeked && !c.error);
    resultEl.dataset.status = ok ? 'pass' : 'fail';
    resultEl.textContent = JSON.stringify({ ok, userAgent: navigator.userAgent, checks }, null, 2);
  } catch (e) {
    resultEl.dataset.status = 'fail';
    resultEl.textContent = String(e);
  }
}

document.getElementById('run')!.addEventListener('click', () => void runSpike());
if (new URLSearchParams(location.search).has('auto')) void runSpike();
