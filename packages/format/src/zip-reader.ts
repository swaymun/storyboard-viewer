import type { SbdReader } from './project.js';
import {
  checkSbdLayout,
  readZipEntry,
  readZipIndex,
  type ByteSource,
  type ZipEntry,
} from './zip.js';

export interface ZipReader extends SbdReader {
  entries: ZipEntry[];
  /** Entry by package path. */
  entry(path: string): ZipEntry | undefined;
  /** Layout problems (empty = OK). */
  layout: string[];
}

/** Reader over a packed `.sbd` from any random-access source (Blob in the browser, file in Node). */
export async function zipReader(src: ByteSource): Promise<ZipReader> {
  const entries = await readZipIndex(src);
  const layout = await checkSbdLayout(src, entries);
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries,
    layout,
    entry: (path) => byName.get(path),
    list: async () =>
      entries.map((e) => e.name).filter((n) => n !== 'mimetype' && !n.endsWith('/')),
    read: async (name) => {
      const e = byName.get(name);
      return e ? readZipEntry(src, e) : null;
    },
  };
}
