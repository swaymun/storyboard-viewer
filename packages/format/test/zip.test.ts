import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  SBD_MIMETYPE,
  blobSource,
  bytesSource,
  checkSbdLayout,
  entryBlob,
  isStoredPath,
  mediaTypeFor,
  packSbd,
  readZipEntry,
  readZipIndex,
  unpackSbd,
  type SbdTree,
} from '../src/index.js';

/** 16-bit mono PCM WAV with a sine tone. */
function makeWav(seconds = 0.5, rate = 8000, freq = 440): Uint8Array {
  const n = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
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
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / rate) * 12000, true);
  return new Uint8Array(buf);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function sampleTree(): SbdTree {
  return {
    'manifest.json': enc.encode(
      JSON.stringify({ format_version: '0.1.0', title: 'Test' }, null, 2),
    ),
    'script.fountain': enc.encode('INT. ROOM - DAY\n\nHe sits.\n'.repeat(50)),
    'ids.json': enc.encode(JSON.stringify({ lines: [] })),
    'shots/s1.json': enc.encode('{"id":"s1"}'),
    'media/tone.wav': makeWav(),
    'media/frame.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
    'media/clip.mp4': new Uint8Array(2048).map((_, i) => (i * 31) & 0xff),
    'media/ünïcödé ✓.webp': new Uint8Array([1, 2, 3]),
  };
}

describe('packSbd', () => {
  const tree = sampleTree();
  const packed = packSbd(tree);

  it('writes an EPUB-style mimetype first entry', () => {
    expect(dec.decode(packed.subarray(0, 4))).toBe('PK\x03\x04');
    expect(packed[8]).toBe(0); // compression method STORE (low byte)
    expect(packed[9]).toBe(0);
    expect(dec.decode(packed.subarray(30, 38))).toBe('mimetype');
    expect(dec.decode(packed.subarray(38, 38 + SBD_MIMETYPE.length))).toBe(SBD_MIMETYPE);
  });

  it('stores media and deflates text', async () => {
    const index = await readZipIndex(bytesSource(packed));
    expect(index[0]!.name).toBe('mimetype');
    for (const e of index) {
      expect(e.method).toBe(e.name === 'mimetype' || isStoredPath(e.name) ? 0 : 8);
    }
    const script = index.find((e) => e.name === 'script.fountain')!;
    expect(script.compressedSize).toBeLessThan(script.size / 5);
    expect(await checkSbdLayout(bytesSource(packed))).toEqual([]);
  });

  it('exposes byte ranges of stored entries that equal the original file', async () => {
    const index = await readZipIndex(bytesSource(packed));
    for (const e of index.filter((x) => x.method === 0 && x.name !== 'mimetype')) {
      expect(packed.subarray(e.dataStart, e.dataEnd)).toEqual(tree[e.name]);
      expect(e.dataEnd - e.dataStart).toBe(e.size);
    }
  });

  it('slices a playable media Blob without decompressing', async () => {
    const blob = new Blob([packed as BlobPart], { type: SBD_MIMETYPE });
    const index = await readZipIndex(blobSource(blob));
    const wav = index.find((e) => e.name === 'media/tone.wav')!;
    const slice = entryBlob(blob, wav);
    expect(slice.type).toBe('audio/wav');
    expect(new Uint8Array(await slice.arrayBuffer())).toEqual(tree['media/tone.wav']);
    const json = index.find((e) => e.name === 'manifest.json')!;
    expect(() => entryBlob(blob, json)).toThrow(/compressed/);
    expect(await readZipEntry(blobSource(blob), json)).toEqual(tree['manifest.json']);
  });

  it('round-trips through unpackSbd', async () => {
    expect(await unpackSbd(packed)).toEqual(tree);
    expect(await unpackSbd(new Blob([packed as BlobPart]))).toEqual(tree);
  });

  it('is deterministic', () => {
    const shuffled = Object.fromEntries(Object.entries(sampleTree()).toReversed());
    expect(packSbd(shuffled)).toEqual(packed);
  });

  it('ignores a mimetype key in the tree', async () => {
    const withMime = { ...tree, mimetype: enc.encode('text/plain') };
    expect(packSbd(withMime)).toEqual(packed);
  });

  it('rejects unsafe paths', () => {
    for (const bad of ['../evil', '/abs', 'a//b', 'a\\b', './x', '']) {
      expect(() => packSbd({ [bad]: new Uint8Array() })).toThrow(/Invalid package path/);
    }
  });

  it('produces an archive that the system unzip accepts', (ctx) => {
    let hasUnzip = true;
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    } catch {
      hasUnzip = false;
    }
    if (!hasUnzip) return ctx.skip();
    const dir = mkdtempSync(join(tmpdir(), 'sbd-'));
    try {
      const file = join(dir, 'story.sbd');
      writeFileSync(file, packed);
      const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
      expect(out).toMatch(/No errors detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('layout validation', () => {
  it('flags a zip without the mimetype entry', async () => {
    const plain = zipSync({ 'manifest.json': enc.encode('{}') });
    expect(await checkSbdLayout(bytesSource(plain))).toContain('first entry must be "mimetype"');
    await expect(unpackSbd(plain)).rejects.toThrow(/Invalid \.sbd/);
    expect(await unpackSbd(plain, { strict: false })).toEqual({
      'manifest.json': enc.encode('{}'),
    });
  });

  it('flags compressed mimetype and compressed media', async () => {
    const bad = zipSync({
      mimetype: [enc.encode(SBD_MIMETYPE), { level: 6 }],
      'media/a.mp3': [new Uint8Array(1000), { level: 6 }],
    });
    const problems = await checkSbdLayout(bytesSource(bad));
    expect(problems).toContain('"mimetype" must be stored uncompressed');
    expect(problems).toContain('media entry media/a.mp3 must be STOREd');
  });

  it('rejects non-zip input', async () => {
    await expect(readZipIndex(bytesSource(enc.encode('hello')))).rejects.toThrow(/Not a zip/);
  });
});

describe('mediaTypeFor', () => {
  it('maps extensions', () => {
    expect(mediaTypeFor('media/a.MP4')).toBe('video/mp4');
    expect(mediaTypeFor('media/a.webm')).toBe('video/webm');
    expect(mediaTypeFor('a.json')).toBe('application/json');
    expect(mediaTypeFor('dir.v2/file')).toBe('application/octet-stream');
    expect(isStoredPath('media/x.svg')).toBe(false);
  });
});
