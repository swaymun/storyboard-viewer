/**
 * Sources for files opened in the browser: a packed .sbd (Blob/File, optionally with a file
 * handle to save in place) and an unpacked folder (File System Access API directory handle,
 * Chromium). Both can save: the folder writes only changed files, the packed file is re-packed.
 */
import {
  PROJECT_FILES,
  blobSource,
  classifySrc,
  diffProjectFiles,
  entryBlob,
  loadProject,
  mimeForPath,
  packSbd,
  projectTree,
  serializeProject,
  zipReader,
  type SbdProject,
  type SbdReader,
} from '@storyboard-viewer/format';
import {
  SaveConflictError,
  type LoadedProject,
  type MediaResolver,
  type ProjectSource,
  type SaveRequest,
} from './types';

const SBD_TYPE = 'application/vnd.sbd+zip';

function embeddedPaths(p: SbdProject): Set<string> {
  const out = new Set<string>();
  for (const a of p.assets.assets) {
    for (const src of [a.src, a.poster, ...(a.variants ?? []).map((v) => v.src)]) {
      const info = src ? classifySrc(src) : null;
      if (info?.kind === 'embedded') out.add(info.path);
    }
  }
  return out;
}

/** Resolver over pre-created object URLs for embedded files; remote URLs pass through. */
function objectUrlResolver(urls: Map<string, string>): MediaResolver {
  return {
    url(src) {
      const info = classifySrc(src);
      if (!info) return null;
      if (info.kind === 'remote') return info.url;
      if (info.kind === 'linked') return null;
      return urls.get(info.path) ?? null;
    },
    reason(src) {
      const info = classifySrc(src);
      if (!info) return 'Invalid source';
      if (info.kind === 'linked')
        return 'Linked file: open the storyboard with `sbd serve` to see it';
      if (info.kind === 'embedded' && !urls.has(info.path)) return `${info.path} is missing`;
      return null;
    },
  };
}

class UrlBag {
  private urls: string[] = [];
  make(blob: Blob): string {
    const u = URL.createObjectURL(blob);
    this.urls.push(u);
    return u;
  }
  revokeAll(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }
}

const isProjectText = (path: string) =>
  path === PROJECT_FILES.manifest ||
  path === PROJECT_FILES.script ||
  path === PROJECT_FILES.ids ||
  path === PROJECT_FILES.assets ||
  path === PROJECT_FILES.timeline ||
  /^shots\/[^/]+\.json$/.test(path);

/** Full package tree: the project's text files + media of `blob` (other files kept) + new media. */
export async function buildTree(
  project: SbdProject,
  blob: Blob | null,
  media: ReadonlyMap<string, Blob>,
): Promise<Record<string, Uint8Array>> {
  const tree: Record<string, Uint8Array> = {};
  if (blob) {
    const reader = await zipReader(blobSource(blob));
    for (const path of await reader.list()) {
      if (isProjectText(path)) continue;
      tree[path] = (await reader.read(path))!;
    }
  }
  for (const [path, b] of media) tree[path] = new Uint8Array(await b.arrayBuffer());
  Object.assign(tree, projectTree(project));
  return tree;
}

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

type SavePicker = (o?: object) => Promise<FileSystemFileHandle>;
const savePicker = (): SavePicker | undefined =>
  (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;

export const canSaveInPlace = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

async function ensureWritable(handle: FileSystemHandle): Promise<void> {
  const h = handle as FileSystemHandle & {
    queryPermission?(o: object): Promise<PermissionState>;
    requestPermission?(o: object): Promise<PermissionState>;
  };
  const opts = { mode: 'readwrite' };
  if ((await h.queryPermission?.(opts)) === 'granted') return;
  if ((await h.requestPermission?.(opts)) === 'denied')
    throw new Error('Write permission was denied');
}

export class CancelledError extends Error {
  override name = 'AbortError';
}

/** Packed .sbd from a Blob or File. Media are sliced straight out of the Blob (no copies). */
export function zipSource(
  initial: Blob,
  initialName: string,
  initialHandle?: FileSystemFileHandle | null,
): ProjectSource & { readonly blob: Blob } {
  const bag = new UrlBag();
  let blob = initial;
  let name = initialName;
  let handle = initialHandle ?? null;
  const source: ProjectSource & { readonly blob: Blob } = {
    kind: 'zip',
    get name() {
      return name;
    },
    readOnly: false,
    get location() {
      return name;
    },
    get saveMode() {
      return handle || canSaveInPlace ? 'file' : 'download';
    },
    get fileHandle() {
      return handle;
    },
    get inPlace() {
      return !!handle;
    },
    get blob() {
      return blob;
    },
    async load(): Promise<LoadedProject> {
      bag.revokeAll();
      const reader = await zipReader(blobSource(blob));
      const { project, issues, reanchor, files } = await loadProject(reader);
      for (const problem of reader.layout)
        issues.unshift({ severity: 'warning', code: 'zip-layout', message: problem });
      const urls = new Map<string, string>();
      for (const path of embeddedPaths(project)) {
        const entry = reader.entry(path);
        if (!entry) continue;
        const media =
          entry.method === 0
            ? entryBlob(blob, entry)
            : new Blob([(await reader.read(path)) as BlobPart], { type: mimeForPath(path) });
        urls.set(path, bag.make(media));
      }
      return { project, issues, reanchor: reanchor ?? null, media: objectUrlResolver(urls), files };
    },
    async save({ project, media }: SaveRequest) {
      const tree = await buildTree(project, blob, media);
      const out = new Blob([packSbd(tree) as BlobPart], { type: SBD_TYPE });
      const pick = savePicker();
      if (!handle && pick) {
        try {
          handle = await pick({
            suggestedName: name.endsWith('.sbd') ? name : `${name}.sbd`,
            types: [{ description: 'Storyboard', accept: { [SBD_TYPE]: ['.sbd'] } }],
          });
        } catch {
          throw new CancelledError('Save cancelled');
        }
        name = handle.name;
      }
      if (handle) {
        await ensureWritable(handle);
        const w = await (
          handle as FileSystemFileHandle & {
            createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
          }
        ).createWritable();
        await w.write(out);
        await w.close();
      } else {
        downloadBlob(out, name.endsWith('.sbd') ? name : `${name}.sbd`);
      }
      blob = out;
      return {
        project,
        message: handle
          ? `Saved ${name}`
          : `Downloaded ${name}. This browser cannot save into the file you opened, so each Save downloads a new copy (Chrome and Edge save in place).`,
      };
    },
    async packed() {
      return blob;
    },
    dispose: () => bag.revokeAll(),
  };
  return source;
}

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

async function walk(dir: DirHandle, prefix = '', out = new Map<string, FileSystemFileHandle>()) {
  for await (const h of dir.values()) {
    if (h.name.startsWith('.')) continue;
    const rel = prefix + h.name;
    if (h.kind === 'directory') await walk(h as DirHandle, `${rel}/`, out);
    else out.set(rel, h as FileSystemFileHandle);
  }
  return out;
}

async function fileAt(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const segs = path.split('/');
  let dir = root;
  for (const s of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create });
  return dir.getFileHandle(segs.at(-1)!, { create });
}

async function writeFile(root: FileSystemDirectoryHandle, path: string, data: Blob | string) {
  const fh = (await fileAt(root, path, true)) as FileSystemFileHandle & {
    createWritable(): Promise<{ write(b: Blob | string): Promise<void>; close(): Promise<void> }>;
  };
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

async function removeFile(root: FileSystemDirectoryHandle, path: string) {
  const segs = path.split('/');
  let dir = root;
  try {
    for (const s of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(s);
    await dir.removeEntry(segs.at(-1)!);
  } catch {
    /* already gone */
  }
}

async function readText(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  try {
    return await (await (await fileAt(root, path, false)).getFile()).text();
  } catch {
    return null;
  }
}

/** Writes a whole tree into `dir` (Export as folder). */
export async function writeTree(
  dir: FileSystemDirectoryHandle,
  tree: Record<string, Uint8Array>,
): Promise<void> {
  for (const [path, bytes] of Object.entries(tree)) {
    if (path === 'mimetype') continue;
    await writeFile(dir, path, new Blob([bytes as BlobPart]));
  }
}

/** Unpacked folder via the File System Access API. Changes are picked up by polling. */
export function folderSource(handle: FileSystemDirectoryHandle): ProjectSource {
  const bag = new UrlBag();
  let files = new Map<string, FileSystemFileHandle>();
  const reader: SbdReader = {
    list: async () => [...files.keys()],
    read: async (path) => {
      const h = files.get(path);
      return h ? new Uint8Array(await (await h.getFile()).arrayBuffer()) : null;
    },
  };
  /** Fingerprint of everything except media contents (size+mtime of every file). */
  const fingerprint = async () => {
    const all = await walk(handle as DirHandle);
    const parts: string[] = [];
    for (const [path, h] of all) {
      const f = await h.getFile();
      parts.push(`${path}:${f.size}:${f.lastModified}`);
    }
    return parts.toSorted().join('|');
  };
  return {
    kind: 'folder',
    name: handle.name,
    handle,
    readOnly: false,
    location: handle.name,
    saveMode: 'folder',
    async load(): Promise<LoadedProject> {
      files = await walk(handle as DirHandle);
      const { project, issues, reanchor } = await loadProject(reader);
      bag.revokeAll();
      const urls = new Map<string, string>();
      for (const path of embeddedPaths(project)) {
        const h = files.get(path);
        if (h) urls.set(path, bag.make(await h.getFile()));
      }
      return {
        project,
        issues,
        reanchor: reanchor ?? null,
        media: objectUrlResolver(urls),
        files: [...files.keys()],
      };
    },
    watch(onChange) {
      let last: string | undefined;
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const fp = await fingerprint();
          if (last !== undefined && fp !== last) onChange({});
          last = fp;
        } catch {
          /* permission revoked or folder gone */
        }
        if (!stopped) setTimeout(tick, 2000);
      };
      void tick();
      return () => {
        stopped = true;
      };
    },
    async save({ base, project, media }: SaveRequest) {
      await ensureWritable(handle);
      const changes = diffProjectFiles(base, project);
      // Optimistic concurrency: refuse to overwrite files changed on disk since `base`.
      const baseFiles = serializeProject(base);
      const conflicts: string[] = [];
      for (const [path, text] of Object.entries(changes)) {
        const disk = await readText(handle, path);
        if (disk !== text && disk !== (baseFiles[path] ?? null)) conflicts.push(path);
      }
      if (conflicts.length) throw new SaveConflictError(conflicts);
      for (const [path, b] of media) await writeFile(handle, path, b);
      for (const [path, text] of Object.entries(changes)) {
        if (text === null) await removeFile(handle, path);
        else await writeFile(handle, path, text);
      }
      return { project, message: `Saved to ${handle.name}` };
    },
    async packed() {
      const tree: Record<string, Uint8Array> = {};
      for (const path of files.keys()) tree[path] = (await reader.read(path))!;
      return new Blob([packSbd(tree) as BlobPart], { type: SBD_TYPE });
    },
    dispose: () => bag.revokeAll(),
  };
}

export const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
export const canPickFile = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

type OpenPicker = (o?: object) => Promise<FileSystemFileHandle[]>;

/**
 * Asks for a .sbd file with the File System Access API (Chromium), so Save can write back into
 * it. Returns null when cancelled or not supported.
 */
export async function pickSbdFile(): Promise<FileSystemFileHandle | null> {
  const pick = (window as unknown as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker;
  if (!pick) return null;
  try {
    const [h] = await pick({
      types: [{ description: 'Storyboard', accept: { [SBD_TYPE]: ['.sbd'] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
    return h ?? null;
  } catch {
    return null;
  }
}
