/** Turning a local file or URL into an asset entry (embed = copy into media/, link = file: path). */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  guessKind,
  mimeForPath,
  probeImageSize,
  probeWavDuration,
  slugify,
  type AssetInput,
  type AssetKind,
} from '@storyboard-viewer/format';
import { linkBase } from '@storyboard-viewer/format/node';

const run = promisify(execFile);

export interface ImportAssetInput {
  /** Local file (absolute or relative to the current directory). */
  path?: string;
  /** Remote URL (https://…, .m3u8 allowed). */
  url?: string;
  /** embed (default for local files) copies into media/; link stores a relative file: path. */
  mode?: 'embed' | 'link';
  id?: string;
  name?: string;
  kind?: AssetKind;
  category?: string;
  tags?: string[];
  notes?: string;
}

export interface Probe {
  duration?: number;
  width?: number;
  height?: number;
  codecs?: string[];
}

/** Uses ffprobe when installed (silently skipped otherwise). */
export async function ffprobe(file: string): Promise<Probe> {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 10_000 },
    );
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        codec_tag_string?: string;
        width?: number;
        height?: number;
      }>;
    };
    const out: Probe = {};
    const d = Number(data.format?.duration);
    if (Number.isFinite(d) && d > 0) out.duration = Math.round(d * 1000) / 1000;
    const video = data.streams?.find((s) => s.codec_type === 'video' && s.width);
    if (video?.width && video.height) {
      out.width = video.width;
      out.height = video.height;
    }
    out.codecs = (data.streams ?? [])
      .map((s) =>
        s.codec_tag_string && !s.codec_tag_string.includes('[')
          ? s.codec_tag_string
          : (s.codec_name ?? ''),
      )
      .filter(Boolean);
    return out;
  } catch {
    return {};
  }
}

async function uniqueMediaPath(
  exists: (rel: string) => boolean | Promise<boolean>,
  stem: string,
  ext: string,
): Promise<string> {
  let rel = `media/${stem}${ext}`;
  for (let n = 2; await exists(rel); n++) rel = `media/${stem}-${n}${ext}`;
  return rel;
}

export interface PrepareOptions {
  /**
   * Packed storyboards: which package paths exist, and collect embedded files into `files`
   * instead of copying them (the caller writes them into the zip with the edit).
   */
  packed?: { exists(rel: string): Promise<boolean> };
}

/**
 * Builds the asset entry and (for embed) copies the file into `media/` of a folder, or (packed)
 * returns its bytes in `files`. Returns the asset input plus the package files created.
 */
export async function prepareAsset(
  projectPath: string,
  input: ImportAssetInput,
  opts: PrepareOptions = {},
): Promise<{ asset: AssetInput; created: string[]; files: Record<string, Uint8Array> }> {
  if (!!input.path === !!input.url)
    throw new Error('Give exactly one of "path" (local file) or "url"');
  if (input.url) {
    if (!/^https?:\/\//i.test(input.url))
      throw new Error('url must start with https:// (or http://)');
    const kind = input.kind ?? guessKind(input.url);
    if (!kind)
      throw new Error(
        'Could not tell the asset kind from the URL; pass kind (image, audio, video or font)',
      );
    const asset: AssetInput = {
      name:
        input.name ?? decodeURIComponent(basename(new URL(input.url).pathname)) ?? 'Remote asset',
      kind,
      src: input.url,
      mime: mimeForPath(input.url),
    };
    return { asset: decorate(asset, input), created: [], files: {} };
  }
  const file = resolve(input.path!);
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) throw new Error(`File not found: ${file}`);
  const kind = input.kind ?? guessKind(file);
  if (!kind)
    throw new Error(
      `Could not tell the asset kind of ${basename(file)}; pass kind (image, audio, video or font)`,
    );
  const bytes = new Uint8Array(await readFile(file));
  const ext = extname(file).toLowerCase();
  const asset: AssetInput = {
    name: input.name ?? basename(file, extname(file)),
    kind,
    src: '',
    mime: mimeForPath(file),
    size: st.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  if (kind === 'image') {
    const dims = probeImageSize(bytes);
    if (dims) Object.assign(asset, dims);
  }
  if (kind === 'audio' || kind === 'video') {
    const wavDur = probeWavDuration(bytes);
    if (wavDur !== null) asset.duration = Math.round(wavDur * 1000) / 1000;
    const probe = await ffprobe(file);
    if (probe.duration !== undefined && asset.duration === undefined)
      asset.duration = probe.duration;
    if (probe.width && probe.height && kind === 'video') {
      asset.width = probe.width;
      asset.height = probe.height;
    }
    if (probe.codecs?.length && kind === 'video')
      asset.mime = `${asset.mime}; codecs="${probe.codecs.join(', ')}"`;
  }
  const created: string[] = [];
  const files: Record<string, Uint8Array> = {};
  const mode = input.mode ?? 'embed';
  if (mode === 'embed') {
    const rel = await uniqueMediaPath(
      opts.packed ? (r) => opts.packed!.exists(r) : (r) => existsSync(join(projectPath, r)),
      slugify(input.name ?? basename(file, ext), 'asset'),
      ext,
    );
    if (opts.packed) files[rel] = bytes;
    else {
      await mkdir(join(projectPath, 'media'), { recursive: true });
      await copyFile(file, join(projectPath, rel));
    }
    asset.src = rel;
    created.push(rel);
  } else {
    const relPath = relative(linkBase(projectPath), file).split(sep).join('/');
    asset.src = `file:${relPath}`;
  }
  return { asset: decorate(asset, input), created, files };
}

function decorate(asset: AssetInput, input: ImportAssetInput): AssetInput {
  if (input.id) asset.id = input.id;
  if (input.category) asset.category = input.category;
  if (input.tags?.length) asset.tags = input.tags;
  if (input.notes) asset.notes = input.notes;
  return asset;
}
