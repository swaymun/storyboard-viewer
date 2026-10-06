/**
 * Node.js adapter (`@storyboard-viewer/format/node`): read/write unpacked folders, read packed
 * `.sbd` files with random access, atomic writes. Not imported by the browser build.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { classifySrc } from './media.js';
import {
  PROJECT_FILES,
  loadProject,
  serializeProject,
  type LoadOptions,
  type LoadResult,
  type SbdReader,
} from './project.js';
import type { SbdProject } from './types.js';
import { packSbd, type ByteSource, type SbdTree } from './zip.js';
import { zipReader, type ZipReader } from './zip-reader.js';

export type ProjectKind = 'folder' | 'packed';

/** True for files that are never part of a package (OS junk, temp files from atomic writes). */
export function isIgnoredPath(rel: string): boolean {
  return rel
    .split('/')
    .some((seg) => seg.startsWith('.') || seg === 'Thumbs.db' || seg.endsWith('~'));
}

async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    const rel = relative(base, abs).split(sep).join('/');
    if (isIgnoredPath(rel)) continue;
    if (ent.isDirectory()) await walk(abs, base, out);
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}

/** Resolves a package-relative path inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  if (
    !rel ||
    rel.includes('\\') ||
    rel.split('/').some((s) => s === '..' || s === '') ||
    isAbsolute(rel)
  ) {
    throw new Error(`Invalid package path: ${JSON.stringify(rel)}`);
  }
  const abs = resolve(root, rel);
  if (!abs.startsWith(resolve(root) + sep)) throw new Error(`Path escapes the package: ${rel}`);
  return abs;
}

export function folderReader(dir: string): SbdReader {
  return {
    list: () => walk(dir),
    read: async (path) => {
      try {
        return new Uint8Array(await readFile(safeJoin(dir, path)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}

/** Random-access source over a file on disk. */
export async function fileSource(path: string): Promise<ByteSource & { close(): Promise<void> }> {
  const fh = await open(path, 'r');
  const { size } = await fh.stat();
  return {
    size,
    read: async (start, end) => {
      const buf = new Uint8Array(Math.max(0, end - start));
      let off = 0;
      while (off < buf.length) {
        const { bytesRead } = await fh.read(buf, off, buf.length - off, start + off);
        if (!bytesRead) break;
        off += bytesRead;
      }
      return buf.subarray(0, off);
    },
    close: () => fh.close(),
  };
}

export interface ZipFileReader extends ZipReader {
  source: ByteSource;
  close(): Promise<void>;
}

/** Reader over a packed `.sbd` on disk; only the central directory is read up front. */
export async function zipFileReader(path: string): Promise<ZipFileReader> {
  const src = await fileSource(path);
  try {
    const reader = await zipReader(src);
    return { ...reader, source: src, close: () => src.close() };
  } catch (e) {
    await src.close();
    throw e;
  }
}

export function projectKind(path: string): ProjectKind {
  const st = statSync(path);
  return st.isDirectory() ? 'folder' : 'packed';
}

/** Directory linked `file:` sources are resolved against: the folder containing the .sbd. */
export function linkBase(projectPath: string): string {
  return dirname(resolve(projectPath));
}

/** Absolute path of a linked `file:` src, or null when the src is not linked. */
export function resolveLinked(projectPath: string, src: string): string | null {
  const info = classifySrc(src);
  if (info?.kind !== 'linked') return null;
  return info.absolute ? info.path : resolve(linkBase(projectPath), info.path);
}

export interface OpenedProject extends LoadResult {
  kind: ProjectKind;
  path: string;
  reader: SbdReader;
  close(): Promise<void>;
}

/** Opens an unpacked folder or packed `.sbd` file. */
export async function openProjectPath(
  path: string,
  opts: LoadOptions = {},
): Promise<OpenedProject> {
  const abs = resolve(path);
  const kind = projectKind(abs);
  const reader = kind === 'folder' ? folderReader(abs) : await zipFileReader(abs);
  const lo: LoadOptions = {
    linkedExists: (src) => {
      const p = resolveLinked(abs, src);
      return p ? existsSync(p) : undefined;
    },
    ...opts,
  };
  try {
    const result = await loadProject(reader, lo);
    if (kind === 'packed') {
      for (const problem of (reader as ZipFileReader).layout) {
        result.issues.unshift({ severity: 'warning', code: 'zip-layout', message: problem });
      }
    }
    return {
      ...result,
      kind,
      path: abs,
      reader,
      close: async () => {
        if (kind === 'packed') await (reader as ZipFileReader).close();
      },
    };
  } catch (e) {
    if (kind === 'packed') await (reader as ZipFileReader).close();
    throw e;
  }
}

/** Writes a file atomically (temp file in the same directory, then rename). */
export async function atomicWriteFile(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export interface WriteResult {
  written: string[];
  deleted: string[];
}

/**
 * Writes the project's text files into an unpacked folder. Only files whose contents changed are
 * written (atomically); shot files of removed shots are deleted. Media files are not touched.
 */
export async function writeProjectToFolder(
  dir: string,
  project: SbdProject,
  opts: { touchModified?: boolean } = {},
): Promise<WriteResult> {
  let files = serializeProject(project);
  const written: string[] = [];
  const deleted: string[] = [];
  const changed: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    const abs = safeJoin(dir, rel);
    let old: string | undefined;
    try {
      old = await readFile(abs, 'utf8');
    } catch {
      old = undefined;
    }
    if (old !== text) changed.push(rel);
  }
  if (
    changed.length &&
    opts.touchModified !== false &&
    changed.some((f) => f !== 'manifest.json')
  ) {
    files = serializeProject({
      ...project,
      manifest: { ...project.manifest, modified: new Date().toISOString() },
    });
    if (!changed.includes('manifest.json')) changed.push('manifest.json');
  }
  for (const rel of changed) {
    await atomicWriteFile(safeJoin(dir, rel), files[rel]!);
    written.push(rel);
  }
  const shotsDir = join(dir, 'shots');
  if (existsSync(shotsDir)) {
    for (const name of await readdir(shotsDir)) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const rel = `shots/${name}`;
      if (!(rel in files)) {
        await rm(join(shotsDir, name));
        deleted.push(rel);
      }
    }
  }
  if (project.script === null && existsSync(join(dir, 'script.fountain'))) {
    await rm(join(dir, 'script.fountain'));
    deleted.push('script.fountain');
  }
  return { written, deleted };
}

/** Reads every package file of an unpacked folder into memory (for packing). */
export async function readFolderTree(dir: string): Promise<SbdTree> {
  const tree: SbdTree = {};
  for (const rel of await walk(dir)) {
    if (rel === 'mimetype') continue;
    tree[rel] = new Uint8Array(await readFile(join(dir, rel)));
  }
  return tree;
}

/** Writes a tree into a folder (used by unpack). */
export async function writeTreeToFolder(dir: string, tree: SbdTree): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [rel, data] of Object.entries(tree)) await atomicWriteFile(safeJoin(dir, rel), data);
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

/** Project text files (rewritten from the model); everything else in a package is kept as is. */
export function isProjectTextFile(path: string): boolean {
  return (
    path === PROJECT_FILES.manifest ||
    path === PROJECT_FILES.script ||
    path === PROJECT_FILES.ids ||
    path === PROJECT_FILES.assets ||
    path === PROJECT_FILES.timeline ||
    /^shots\/[^/]+\.json$/.test(path)
  );
}

/** Backup written next to a packed file before it is first replaced (`story.sbd.bak`). */
export const backupPath = (path: string): string => `${path}.bak`;

export interface PackedWriteOptions {
  /** Extra package files to add or replace (e.g. new media). */
  add?: Record<string, Uint8Array>;
  /** Copy the current file to `<file>.bak` before replacing it. */
  backup?: boolean;
  /** Set manifest.modified when something changed (default true). */
  touchModified?: boolean;
}

/**
 * Saves a project into a packed `.sbd` in place: reads the current zip, keeps its media and other
 * files, replaces the project's text files (and adds `opts.add`), re-packs (media STOREd,
 * `mimetype` first) and replaces the file atomically (temp file in the same folder + rename), so
 * a reader never sees a half-written file. Returns the package paths that changed. Nothing is
 * written when nothing changed.
 */
export async function writeProjectToPacked(
  file: string,
  project: SbdProject,
  opts: PackedWriteOptions = {},
): Promise<WriteResult> {
  const reader = await zipFileReader(file);
  const tree: SbdTree = {};
  const oldText = new Map<string, string>();
  const dec = new TextDecoder();
  try {
    for (const path of await reader.list()) {
      if (path === 'mimetype') continue;
      const bytes = (await reader.read(path))!;
      if (isProjectTextFile(path)) oldText.set(path, dec.decode(bytes));
      else tree[path] = bytes;
    }
  } finally {
    await reader.close();
  }
  let files = serializeProject(project);
  const changed = Object.keys(files).filter((p) => oldText.get(p) !== files[p]);
  const deleted = [...oldText.keys()].filter((p) => !(p in files));
  const added = Object.keys(opts.add ?? {});
  if (!changed.length && !deleted.length && !added.length) return { written: [], deleted: [] };
  if (
    (changed.length || deleted.length) &&
    opts.touchModified !== false &&
    changed.some((f) => f !== 'manifest.json')
  ) {
    files = serializeProject({
      ...project,
      manifest: { ...project.manifest, modified: new Date().toISOString() },
    });
    if (!changed.includes('manifest.json')) changed.push('manifest.json');
  }
  const enc = new TextEncoder();
  for (const [k, v] of Object.entries(files)) tree[k] = enc.encode(v);
  Object.assign(tree, opts.add ?? {});
  const bytes = packSbd(tree);
  if (opts.backup) await copyFile(file, backupPath(file));
  await atomicWriteFile(file, bytes);
  return { written: [...changed, ...added], deleted };
}

/** Package paths inside a packed `.sbd` (for unique media names). */
export async function packedPaths(file: string): Promise<Set<string>> {
  const reader = await zipFileReader(file);
  try {
    return new Set(await reader.list());
  } finally {
    await reader.close();
  }
}
