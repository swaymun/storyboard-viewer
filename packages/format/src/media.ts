/**
 * Media helpers shared by Node and the browser: asset `src` classification, MIME types by
 * extension and the browser-safe media list documented in SPEC.md.
 */
import type { Asset, AssetKind } from './types.js';
import { mediaTypeFor } from './zip.js';

export type SrcInfo =
  | { kind: 'embedded'; path: string }
  | { kind: 'linked'; path: string; absolute: boolean }
  | { kind: 'remote'; url: string; hls: boolean };

/** Splits an asset `src` into embedded (`media/…`), linked (`file:…`) or remote (`http(s)://…`). */
export function classifySrc(src: string): SrcInfo | null {
  if (src.startsWith('media/')) {
    const segs = src.split('/');
    if (src.includes('\\') || segs.some((s) => s === '' || s === '.' || s === '..')) return null;
    return { kind: 'embedded', path: src };
  }
  if (src.startsWith('file:')) {
    let rest = src.slice(5);
    let absolute = false;
    if (rest.startsWith('///')) {
      rest = rest.slice(2);
      absolute = true;
    } else if (rest.startsWith('/')) absolute = true;
    if (!rest) return null;
    let path: string;
    try {
      path = decodeURI(rest);
    } catch {
      path = rest;
    }
    return { kind: 'linked', path, absolute };
  }
  if (/^https?:\/\//i.test(src)) {
    const hls = /\.m3u8(?:$|[?#])/i.test(src);
    return { kind: 'remote', url: src, hls };
  }
  return null;
}

function extOf(path: string): string {
  const clean = path.replace(/[?#].*$/, '');
  const dot = clean.lastIndexOf('.');
  return dot > clean.lastIndexOf('/') ? clean.slice(dot + 1).toLowerCase() : '';
}

const EXTRA_TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  psd: 'image/vnd.adobe.photoshop',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  wma: 'audio/x-ms-wma',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
};

/** MIME type guessed from a path or URL extension. */
export function mimeForPath(path: string): string {
  const ext = extOf(path);
  return EXTRA_TYPES[ext] ?? mediaTypeFor(`x.${ext}`);
}

/** Asset kind guessed from a path or MIME type. */
export function guessKind(pathOrMime: string): AssetKind | undefined {
  const mime = pathOrMime.includes('/') && !pathOrMime.includes('.') ? pathOrMime : '';
  const m = mime || mimeForPath(pathOrMime);
  if (m === 'application/vnd.apple.mpegurl') return 'video';
  const top = m.split('/')[0];
  if (top === 'image' || top === 'audio' || top === 'video' || top === 'font') return top;
  return undefined;
}

export interface MediaSupport {
  ext: string[];
  kind: AssetKind;
  /** Plain-language note for SPEC.md and warnings. */
  note: string;
}

/** Formats that play in current Chromium, Firefox and Safari (see SPEC.md "Browser-safe media"). */
export const BROWSER_SAFE_MEDIA: readonly MediaSupport[] = [
  { kind: 'image', ext: ['webp', 'avif', 'png', 'jpg', 'jpeg', 'gif', 'svg'], note: 'Images' },
  { kind: 'audio', ext: ['mp3'], note: 'MP3' },
  { kind: 'audio', ext: ['m4a', 'aac'], note: 'AAC in MP4/M4A' },
  { kind: 'audio', ext: ['opus', 'ogg', 'oga', 'weba'], note: 'Opus (Ogg/WebM)' },
  { kind: 'audio', ext: ['wav'], note: 'WAV (PCM)' },
  { kind: 'audio', ext: ['flac'], note: 'FLAC' },
  { kind: 'video', ext: ['mp4', 'm4v'], note: 'MP4 with H.264 video + AAC audio, faststart' },
  { kind: 'video', ext: ['webm'], note: 'WebM with VP9 or AV1 video + Opus audio' },
  { kind: 'video', ext: ['m3u8'], note: 'HLS stream (remote only)' },
  { kind: 'font', ext: ['woff2', 'woff', 'ttf', 'otf'], note: 'Fonts' },
];

const SAFE_EXT = new Set(BROWSER_SAFE_MEDIA.flatMap((m) => m.ext));

const UNSAFE_HINTS: Record<string, string> = {
  mov: 'QuickTime .mov often uses ProRes/HEVC; convert to MP4 (H.264/AAC) or WebM',
  mkv: 'Matroska .mkv does not play in Safari; convert to MP4 or WebM',
  avi: 'AVI does not play in browsers; convert to MP4 or WebM',
  wmv: 'WMV does not play in browsers; convert to MP4 or WebM',
  flv: 'FLV does not play in browsers; convert to MP4 or WebM',
  mpg: 'MPEG-1/2 does not play in browsers; convert to MP4 or WebM',
  mpeg: 'MPEG-1/2 does not play in browsers; convert to MP4 or WebM',
  tif: 'TIFF does not display in most browsers; convert to PNG/WebP',
  tiff: 'TIFF does not display in most browsers; convert to PNG/WebP',
  heic: 'HEIC displays only in Safari; convert to WebP/AVIF/JPEG',
  heif: 'HEIF displays only in Safari; convert to WebP/AVIF/JPEG',
  psd: 'PSD is not an image format browsers can show; export PNG/WebP',
  aif: 'AIFF does not play in Chromium/Firefox; convert to WAV/MP3/M4A',
  aiff: 'AIFF does not play in Chromium/Firefox; convert to WAV/MP3/M4A',
  wma: 'WMA does not play in browsers; convert to MP3/M4A',
};

const UNSAFE_CODECS: Array<[RegExp, string]> = [
  [/hvc1|hev1|hevc|h265/i, 'HEVC/H.265 video does not play in Firefox and most Chromium on Linux'],
  [/apcn|apch|apcs|apco|ap4h|prores/i, 'ProRes does not play in browsers'],
  [/ac-3|ec-3|ac3|eac3/i, 'Dolby AC-3/E-AC-3 audio does not play in most browsers'],
];

/** A warning when the asset's format is unlikely to play in all browsers; null when fine. */
export function playabilityWarning(asset: Pick<Asset, 'src' | 'mime' | 'kind'>): string | null {
  const info = classifySrc(asset.src);
  const path = info?.kind === 'remote' ? info.url : (info?.path ?? asset.src);
  const ext = extOf(path);
  if (asset.mime) {
    for (const [re, msg] of UNSAFE_CODECS) if (re.test(asset.mime)) return msg;
  }
  if (UNSAFE_HINTS[ext]) return UNSAFE_HINTS[ext]!;
  if (ext && !SAFE_EXT.has(ext) && asset.kind !== 'font') {
    return `.${ext} is not in the browser-safe media list (see SPEC.md)`;
  }
  if (ext === 'm3u8' && info?.kind !== 'remote')
    return 'HLS (.m3u8) is supported only for https:// sources';
  return null;
}

/** Reads width/height from PNG, JPEG, GIF, WebP or SVG bytes; null when unknown. */
export function probeImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length;
  // PNG
  if (n >= 24 && dv.getUint32(0) === 0x89504e47 && dv.getUint32(12) === 0x49484452) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // GIF
  if (n >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }
  // WebP
  if (n >= 30 && dv.getUint32(0) === 0x52494646 && dv.getUint32(8) === 0x57454250) {
    const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (chunk === 'VP8X') {
      const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width: w, height: h };
    }
    if (chunk === 'VP8 ') {
      return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b = dv.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < n) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = dv.getUint16(i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  // SVG
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(n, 2048)));
  if (/<svg[\s>]/i.test(head)) {
    const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? '';
    const num = (name: string) => {
      const m = new RegExp(`\\s${name}="([\\d.]+)(?:px)?"`).exec(tag);
      return m ? Number(m[1]) : undefined;
    };
    const w = num('width');
    const h = num('height');
    if (w && h) return { width: w, height: h };
    const vb = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(tag);
    if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  }
  return null;
}

/** Duration of a PCM WAV file in seconds; null when not a WAV. */
export function probeWavDuration(bytes: Uint8Array): number | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || dv.getUint32(0) !== 0x52494646 || dv.getUint32(8) !== 0x57415645) {
    return null;
  }
  let i = 12;
  let byteRate = 0;
  while (i + 8 <= bytes.length) {
    const id = dv.getUint32(i);
    const size = dv.getUint32(i + 4, true);
    if (id === 0x666d7420 /* fmt */) byteRate = dv.getUint32(i + 16, true);
    if (id === 0x64617461 /* data */ && byteRate) {
      const dataSize = Math.min(size, bytes.length - i - 8);
      return dataSize / byteRate;
    }
    i += 8 + size + (size & 1);
  }
  return null;
}

/** Package paths (`media/…`) referenced by assets: `src`, `poster` and rendition `src`. */
export function referencedMedia(p: { assets: { assets: readonly Asset[] } }): Set<string> {
  const out = new Set<string>();
  const add = (src: string | undefined) => {
    if (!src) return;
    const info = classifySrc(src);
    if (info?.kind === 'embedded') out.add(info.path);
  };
  for (const a of p.assets.assets) {
    add(a.src);
    add(a.poster);
    for (const v of a.variants ?? []) add(v.src);
  }
  return out;
}

/** Files under `media/` that no asset refers to (candidates for `sbd clean`). */
export function unreferencedMedia(
  p: { assets: { assets: readonly Asset[] } },
  files: Iterable<string>,
): string[] {
  const used = referencedMedia(p);
  return [...files].filter((f) => f.startsWith('media/') && !used.has(f)).sort();
}
