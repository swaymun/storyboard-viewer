/**
 * Packed `.sbd` (zip) support built on fflate.
 *
 * Layout rules (EPUB-style):
 *  - first entry is `mimetype`, STOREd, containing exactly `application/vnd.sbd+zip`, no extra field
 *  - media (images, audio, video, fonts) are STOREd so a reader can `blob.slice(start, end)` and
 *    hand the slice to `<audio>`/`<video>`/`<img>` without decompressing
 *  - everything else (JSON, Fountain, text) is DEFLATEd
 *  - entries after `mimetype` are sorted by path and get a fixed mtime → byte-identical output
 *    for identical input (nice for git and tests)
 *
 * Not supported yet: ZIP64 (> 4 GiB or > 65535 entries), encryption, multi-disk archives.
 */
import { inflateSync, unzipSync, zipSync, type Zippable } from 'fflate';

export const SBD_MIMETYPE = 'application/vnd.sbd+zip';

/** Unpacked tree: package-relative POSIX path → file bytes. Never contains `mimetype`. */
export type SbdTree = Record<string, Uint8Array>;

const MEDIA_TYPES: Record<string, string> = {
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  // audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  weba: 'audio/webm',
  // video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  // fonts (already compressed or rarely worth it)
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

const TEXT_TYPES: Record<string, string> = {
  json: 'application/json',
  fountain: 'text/plain',
  txt: 'text/plain',
  md: 'text/markdown',
  svg: 'image/svg+xml',
};

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : '';
}

/** MIME type for a package path, by extension. */
export function mediaTypeFor(path: string): string {
  const ext = extOf(path);
  return MEDIA_TYPES[ext] ?? TEXT_TYPES[ext] ?? 'application/octet-stream';
}

/** True when the entry is stored uncompressed (media and fonts). */
export function isStoredPath(path: string): boolean {
  return extOf(path) in MEDIA_TYPES;
}

// DOS time can't represent < 1980; local-time fields keep this timezone-independent.
const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0);

export interface PackOptions {
  /** Deflate level for non-media entries (1–9). Default 6. */
  level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Entry modification time. Default 1980-01-01 for reproducible output. */
  mtime?: Date;
}

function checkPath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error(`Invalid package path: ${JSON.stringify(path)}`);
  }
}

export function packSbd(tree: SbdTree, options: PackOptions = {}): Uint8Array {
  const { level = 6, mtime = FIXED_MTIME } = options;
  const files: Zippable = {
    mimetype: [new TextEncoder().encode(SBD_MIMETYPE), { level: 0, mtime }],
  };
  for (const path of Object.keys(tree).toSorted()) {
    if (path === 'mimetype') continue;
    checkPath(path);
    files[path] = [tree[path]!, { level: isStoredPath(path) ? 0 : level, mtime }];
  }
  return zipSync(files);
}

// ---------------------------------------------------------------------------
// Reader: central directory index with byte ranges.

export interface ZipEntry {
  name: string;
  /** 0 = STORE, 8 = DEFLATE */
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  localHeaderOffset: number;
  /** Offset of the entry's (possibly compressed) data in the archive. */
  dataStart: number;
  /** `dataStart + compressedSize`. For STOREd entries `[dataStart, dataEnd)` is the file. */
  dataEnd: number;
}

/** Random-access byte source (a Blob/File in the browser, bytes or a file handle in Node). */
export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (start, end) => bytes.subarray(start, end) };
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()),
  };
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export async function readZipIndex(src: ByteSource): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, src.size - EOCD_MIN - MAX_COMMENT);
  const tail = await src.read(tailStart, src.size);
  const t = dv(tail);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (t.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (end of central directory not found)');
  const count = t.getUint16(eocd + 10, true);
  const cdSize = t.getUint32(eocd + 12, true);
  const cdOffset = t.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }
  const cd = await src.read(cdOffset, cdOffset + cdSize);
  const c = dv(cd);
  const decoder = new TextDecoder();
  const entries: Array<Omit<ZipEntry, 'dataStart' | 'dataEnd'>> = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (c.getUint32(p, true) !== CEN_SIG) throw new Error('Corrupt central directory');
    const nameLen = c.getUint16(p + 28, true);
    const extraLen = c.getUint16(p + 30, true);
    const commentLen = c.getUint16(p + 32, true);
    entries.push({
      name: decoder.decode(cd.subarray(p + 46, p + 46 + nameLen)),
      method: c.getUint16(p + 10, true),
      crc32: c.getUint32(p + 16, true),
      compressedSize: c.getUint32(p + 20, true),
      size: c.getUint32(p + 24, true),
      localHeaderOffset: c.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  // The local header's name/extra lengths may differ from the central copy: read each one.
  return Promise.all(
    entries.map(async (e) => {
      const h = await src.read(e.localHeaderOffset, e.localHeaderOffset + 30);
      const hv = dv(h);
      if (h.length < 30 || hv.getUint32(0, true) !== LOC_SIG) {
        throw new Error(`Corrupt local header for ${e.name}`);
      }
      const dataStart = e.localHeaderOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      return { ...e, dataStart, dataEnd: dataStart + e.compressedSize };
    }),
  );
}

/** Reads and (if needed) inflates one entry. */
export async function readZipEntry(src: ByteSource, entry: ZipEntry): Promise<Uint8Array> {
  const data = await src.read(entry.dataStart, entry.dataEnd);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateSync(data, { out: new Uint8Array(entry.size) });
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * Zero-copy Blob for a STOREd entry: `blob.slice(dataStart, dataEnd)` with the right MIME type.
 * Use with `URL.createObjectURL` for `<audio>`, `<video>` and `<img>`.
 */
export function entryBlob(blob: Blob, entry: ZipEntry, type = mediaTypeFor(entry.name)): Blob {
  if (entry.method !== 0)
    throw new Error(`${entry.name} is compressed; read it instead of slicing`);
  return blob.slice(entry.dataStart, entry.dataEnd, type);
}

/** Problems with the packed layout (empty array = OK). */
export async function checkSbdLayout(src: ByteSource, entries?: ZipEntry[]): Promise<string[]> {
  const index = entries ?? (await readZipIndex(src));
  const problems: string[] = [];
  const first = index[0];
  if (!first || first.name !== 'mimetype') problems.push('first entry must be "mimetype"');
  else {
    if (first.method !== 0) problems.push('"mimetype" must be stored uncompressed');
    if (first.localHeaderOffset !== 0) problems.push('"mimetype" must start at offset 0');
    if (first.dataStart !== 38) problems.push('"mimetype" local header must have no extra field');
    const text = new TextDecoder().decode(await readZipEntry(src, first));
    if (text !== SBD_MIMETYPE) problems.push(`"mimetype" must be ${SBD_MIMETYPE}`);
  }
  for (const e of index) {
    if (isStoredPath(e.name) && e.method !== 0)
      problems.push(`media entry ${e.name} must be STOREd`);
  }
  return problems;
}

export interface UnpackOptions {
  /** Throw if the layout check fails (default true). */
  strict?: boolean;
}

/** Unpacks a packed `.sbd` into a tree (without `mimetype`). */
export async function unpackSbd(
  input: Uint8Array | Blob,
  options: UnpackOptions = {},
): Promise<SbdTree> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  if (options.strict ?? true) {
    const problems = await checkSbdLayout(bytesSource(bytes));
    if (problems.length) throw new Error(`Invalid .sbd: ${problems.join('; ')}`);
  }
  const files = unzipSync(bytes);
  const tree: SbdTree = {};
  for (const [path, data] of Object.entries(files)) {
    if (path === 'mimetype' || path.endsWith('/')) continue;
    checkPath(path);
    tree[path] = data;
  }
  return tree;
}
