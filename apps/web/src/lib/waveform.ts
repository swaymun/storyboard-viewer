/**
 * Waveform peaks for the timeline editor: the file is decoded once with Web Audio and reduced to
 * one peak (max |sample| over all channels) per 10 ms. Results are cached per URL for the session.
 */
export interface Peaks {
  /** Peak per bucket, 0…1. */
  data: Float32Array;
  /** Buckets per second. */
  rate: number;
  duration: number;
}

export const PEAK_RATE = 100;

const cache = new Map<string, Promise<Peaks>>();
let ctx: BaseAudioContext | null = null;

function audioContext(): BaseAudioContext {
  // An OfflineAudioContext can decode without a user gesture.
  ctx ??= new OfflineAudioContext(1, 1, 44100);
  return ctx;
}

export function computePeaks(
  channels: Float32Array[],
  sampleRate: number,
  rate = PEAK_RATE,
): Peaks {
  const length = channels[0]?.length ?? 0;
  const per = Math.max(1, Math.round(sampleRate / rate));
  const n = Math.ceil(length / per);
  const data = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let max = 0;
    const end = Math.min(length, (b + 1) * per);
    for (const ch of channels)
      for (let i = b * per; i < end; i++) {
        const v = Math.abs(ch[i]!);
        if (v > max) max = v;
      }
    data[b] = max;
  }
  return { data, rate: sampleRate / per, duration: length / sampleRate };
}

export function loadPeaks(url: string): Promise<Peaks> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load audio (${res.status})`);
      const buf = await audioContext().decodeAudioData(await res.arrayBuffer());
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) =>
        buf.getChannelData(i),
      );
      return computePeaks(channels, buf.sampleRate);
    })();
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
