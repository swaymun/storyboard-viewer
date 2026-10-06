// Tiny synth + 16-bit PCM WAV writer for generated placeholder audio.

export function wav(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) =>
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2),
  );
  return buf;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const env = (t, len, attack = 0.02, release = 0.08) =>
  Math.min(1, t / attack, (len - t) / release, 1) * (t < len ? 1 : 0);

/**
 * A "speech-like" phrase: a pitch-gliding buzz shaped into syllables. Not speech, but clearly
 * distinct per segment, so trimmed cues are audible in the animatic.
 */
export function phrase(out, sr, start, len, { pitch = 180, syllables = 6, seed = 1 } = {}) {
  const rand = rng(seed);
  const sylLen = len / syllables;
  const sylPitch = Array.from({ length: syllables }, () => pitch * (0.85 + rand() * 0.35));
  for (let i = 0; i < len * sr; i++) {
    const t = i / sr;
    const k = Math.min(syllables - 1, Math.floor(t / sylLen));
    const st = t - k * sylLen;
    const f = sylPitch[k] * (1 + 0.05 * Math.sin(2 * Math.PI * 5 * t));
    const phase = 2 * Math.PI * f * t;
    const formant = 0.6 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);
    const syl = Math.sin((Math.PI * st) / sylLen) ** 0.6;
    const idx = Math.floor((start + t) * sr);
    if (idx < out.length) out[idx] += 0.45 * formant * syl * env(t, len);
  }
}

export function pad(out, sr, start, len, freqs, gain = 0.12) {
  for (let i = 0; i < len * sr; i++) {
    const t = i / sr;
    let s = 0;
    for (const f of freqs)
      s += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.001 * t);
    const idx = Math.floor((start + t) * sr);
    if (idx < out.length) out[idx] += (gain * s * env(t, len, 0.6, 0.6)) / freqs.length;
  }
}

export function noiseBurst(out, sr, start, len, seed = 7, gain = 0.6) {
  const rand = rng(seed);
  let lp = 0;
  for (let i = 0; i < len * sr; i++) {
    const t = i / sr;
    lp = lp * 0.7 + (rand() * 2 - 1) * 0.3;
    const idx = Math.floor((start + t) * sr);
    if (idx < out.length) out[idx] += gain * lp * Math.exp(-t * 6) * env(t, len, 0.005, 0.05);
  }
}
