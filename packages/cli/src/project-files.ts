/** File-level operations shared by CLI commands and the MCP server. */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  createProject,
  packSbd,
  parseStoryboarderScene,
  projectFromFountain,
  projectFromStoryboarder,
  unpackSbd,
  unreferencedMedia,
  updateAsset,
  type NewProjectOptions,
  type ShotSplit,
  type PresetId,
} from '@storyboard-viewer/format';
import {
  atomicWriteFile,
  folderReader,
  openProjectPath,
  readFolderTree,
  safeJoin,
  writeProjectToFolder,
  writeTreeToFolder,
} from '@storyboard-viewer/format/node';

function assertEmptyTarget(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length) {
    throw new Error(`${dir} already exists and is not empty`);
  }
}

/** Creates a new unpacked storyboard folder (with empty media/ and shots/). */
export async function createStoryboard(dir: string, opts: NewProjectOptions): Promise<void> {
  assertEmptyTarget(dir);
  await mkdir(join(dir, 'media'), { recursive: true });
  await mkdir(join(dir, 'shots'), { recursive: true });
  await writeProjectToFolder(dir, createProject(opts), { touchModified: false });
}

export async function importFountainFile(
  file: string,
  dir: string,
  opts: { title?: string; preset?: PresetId; split?: ShotSplit; aspect_ratio?: string },
): Promise<{ shots: number; lines: number }> {
  const script = await readFile(file, 'utf8');
  assertEmptyTarget(dir);
  const p = projectFromFountain(script, opts);
  await mkdir(join(dir, 'media'), { recursive: true });
  await writeProjectToFolder(dir, p, { touchModified: false });
  return { shots: p.ids.shots.length, lines: p.ids.lines.length };
}

/** Sibling path with the same stem; falls back to `<stem><suffix><ext>` when it collides with `input`. */
export function defaultOutput(input: string, ext: string, collisionSuffix: string): string {
  const abs = resolve(input.replace(/[/\\]+$/, ''));
  const stem = basename(abs, extname(abs));
  const candidate = join(dirname(abs), `${stem}${ext}`);
  return candidate === abs ? join(dirname(abs), `${stem}${collisionSuffix}${ext}`) : candidate;
}

export async function packFolder(
  dir: string,
  out: string,
): Promise<{ bytes: number; files: number }> {
  const tree = await readFolderTree(dir);
  const zip = packSbd(tree);
  await atomicWriteFile(out, zip);
  return { bytes: zip.length, files: Object.keys(tree).length };
}

export async function unpackFile(file: string, dir: string): Promise<{ files: number }> {
  assertEmptyTarget(dir);
  const tree = await unpackSbd(new Uint8Array(await readFile(file)));
  await writeTreeToFolder(dir, tree);
  return { files: Object.keys(tree).length };
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, text);
}

/**
 * Converts a Storyboarder scene (`scene.storyboarder` + its `images/` folder) into a new
 * unpacked storyboard. Only files the scene references are read and copied.
 */
export async function importStoryboarderFile(
  file: string,
  dir: string,
  opts: { title?: string; preset?: PresetId },
): Promise<{ shots: number; lines: number; assets: number; warnings: string[] }> {
  const scene = parseStoryboarderScene(await readFile(file, 'utf8'));
  assertEmptyTarget(dir);
  const images = join(dirname(resolve(file)), 'images');
  const names = new Set<string>();
  for (const b of scene.boards) {
    if (b.url) {
      names.add(b.url);
      names.add(b.url.replace(/\.png$/i, '-posterframe.jpg'));
    }
    for (const l of Object.values(b.layers ?? {})) if (l?.url) names.add(l.url);
    if (b.audio?.filename) names.add(b.audio.filename);
  }
  const files = new Map<string, Uint8Array>();
  for (const name of names) {
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) continue;
    try {
      files.set(name, new Uint8Array(await readFile(join(images, name))));
    } catch {
      /* missing files are reported by the importer */
    }
  }
  const title = opts.title ?? basename(file, extname(file));
  const r = projectFromStoryboarder(scene, {
    title,
    files,
    ...(opts.preset ? { preset: opts.preset } : {}),
  });
  let p = r.project;
  for (const a of p.assets.assets) {
    const bytes = r.media[a.src];
    if (bytes)
      p = updateAsset(p, a.id, { sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await mkdir(join(dir, 'media'), { recursive: true });
  for (const [path, bytes] of Object.entries(r.media))
    await atomicWriteFile(join(dir, path), bytes);
  await writeProjectToFolder(dir, p, { touchModified: false });
  return {
    shots: p.ids.shots.length,
    lines: p.ids.lines.length,
    assets: p.assets.assets.length,
    warnings: r.warnings,
  };
}

/** Files under media/ of an unpacked storyboard that no asset refers to, with sizes. */
export async function findUnusedMedia(
  dir: string,
): Promise<Array<{ path: string; bytes: number }>> {
  const opened = await openProjectPath(dir);
  await opened.close();
  if (opened.kind !== 'folder')
    throw new Error('sbd clean works on unpacked folders (sbd unpack first)');
  const files = await folderReader(dir).list();
  const out: Array<{ path: string; bytes: number }> = [];
  for (const path of unreferencedMedia(opened.project, files)) {
    out.push({ path, bytes: (await stat(safeJoin(dir, path))).size });
  }
  return out;
}

/** Deletes the given package files and then any media/ sub-folders left empty. */
export async function removeMediaFiles(dir: string, paths: readonly string[]): Promise<void> {
  const parents = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith('media/')) throw new Error(`Refusing to delete outside media/: ${p}`);
    await unlink(safeJoin(dir, p));
    const segs = p.split('/');
    for (let i = segs.length - 1; i > 1; i--) parents.add(segs.slice(0, i).join('/'));
  }
  for (const p of [...parents].sort((a, b) => b.length - a.length)) {
    try {
      await rmdir(safeJoin(dir, p)); // only succeeds when empty
    } catch {
      /* not empty */
    }
  }
}
