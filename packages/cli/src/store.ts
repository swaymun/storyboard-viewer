/**
 * ProjectStore: one storyboard on disk. Loads fresh state for every read (so hand edits are
 * always picked up), applies edit operations with validation and atomic writes, and emits change
 * events (consumed by the HTTP server's SSE stream).
 */
import { EventEmitter } from 'node:events';
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { hasErrors, validateProject, type Issue, type SbdProject } from '@storyboard-viewer/format';
import {
  isIgnoredPath,
  openProjectPath,
  projectKind,
  resolveLinked,
  writeProjectToFolder,
  type OpenedProject,
  type ProjectKind,
} from '@storyboard-viewer/format/node';

export class EditRejectedError extends Error {
  override name = 'EditRejectedError';
  constructor(
    message: string,
    readonly issues: Issue[],
  ) {
    super(message);
  }
}

export interface ChangeEvent {
  revision: number;
  files: string[];
  source: 'edit' | 'watch';
  /** Client that made the edit (the web app passes its client ID when saving). */
  origin?: string;
}

const issueKey = (i: Issue) => `${i.code}|${i.file ?? ''}|${i.message}`;

export class ProjectStore extends EventEmitter<{ change: [ChangeEvent] }> {
  readonly path: string;
  readonly kind: ProjectKind;
  revision = 0;
  private watcher: FSWatcher | undefined;
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  /**
   * Files this process wrote, with their size+mtime right after the write. The watcher skips
   * events while a file still has that stamp (our own echo) but reports any later change, even
   * one made a few milliseconds later by another process (an agent).
   */
  private recentWrites = new Map<string, string>();

  private constructor(path: string, kind: ProjectKind) {
    super();
    this.path = path;
    this.kind = kind;
  }

  static open(path: string): ProjectStore {
    const abs = resolve(path);
    if (!existsSync(abs)) throw new Error(`No storyboard at ${abs}`);
    const kind = projectKind(abs);
    if (kind === 'folder' && !existsSync(resolve(abs, 'manifest.json'))) {
      throw new Error(`${abs} is not a storyboard folder (manifest.json missing)`);
    }
    return new ProjectStore(abs, kind);
  }

  get name(): string {
    return basename(this.path);
  }

  get readOnly(): boolean {
    return this.kind === 'packed';
  }

  /** Loads the current state from disk (re-anchoring in memory if the script changed). */
  async load(): Promise<OpenedProject> {
    const opened = await openProjectPath(this.path);
    await opened.close();
    return opened;
  }

  linkedPath(src: string): string | null {
    return resolveLinked(this.path, src);
  }

  /**
   * Applies `fn` to the current project, validates and writes. Edits that introduce new
   * validation errors are rejected (errors that existed before do not block unrelated edits).
   */
  async edit<T extends { project: SbdProject }>(
    fn: (p: SbdProject, opened: OpenedProject) => T | Promise<T>,
    opts: { origin?: string } = {},
  ): Promise<T & { issues: Issue[]; written: string[] }> {
    if (this.readOnly) {
      throw new Error(
        `${this.name} is a packed .sbd (read-only). Unpack it first: sbd unpack "${this.path}"`,
      );
    }
    const opened = await this.load();
    const result = await fn(opened.project, opened);
    const files = new Set(opened.files);
    const issues = validateProject(result.project, {
      hasFile: (p) => files.has(p),
      linkedExists: (src) => {
        const abs = this.linkedPath(src);
        return abs ? existsSync(abs) : undefined;
      },
    });
    if (hasErrors(issues)) {
      const before = new Set(opened.issues.map(issueKey));
      const fresh = issues.filter((i) => i.severity === 'error' && !before.has(issueKey(i)));
      if (fresh.length) {
        throw new EditRejectedError(
          `The edit was not saved because it would make the storyboard invalid:\n${fresh.map((i) => `- ${i.message}`).join('\n')}`,
          fresh,
        );
      }
    }
    const { written, deleted } = await writeProjectToFolder(this.path, result.project);
    const changed = [...written, ...deleted];
    this.markWritten(changed);
    if (changed.length) this.notify(changed, 'edit', opts.origin);
    return { ...result, issues, written: changed };
  }

  /** Remembers files written by this process so the watcher skips their echo. */
  markWritten(files: readonly string[]): void {
    for (const f of files) {
      const stamp = this.stamp(f);
      if (stamp) this.recentWrites.set(f, stamp);
      else this.recentWrites.delete(f);
    }
  }

  private stamp(rel: string): string | null {
    try {
      const st = statSync(join(this.path, rel));
      return `${st.size}:${st.mtimeMs}:${st.ino}`;
    } catch {
      return 'deleted';
    }
  }

  /** Emits a change event right away (also used after media files are copied in). */
  notify(files: string[], source: ChangeEvent['source'], origin?: string): void {
    this.revision++;
    const ev: ChangeEvent = { revision: this.revision, files, source };
    if (origin) ev.origin = origin;
    this.emit('change', ev);
  }

  /** Watches the folder (or packed file) and emits debounced change events. */
  startWatching(debounceMs = 120): void {
    if (this.watcher) return;
    const onEvent = (file: string | null) => {
      const rel = (file ?? '').split('\\').join('/');
      if (this.kind === 'folder' && rel && isIgnoredPath(rel)) return;
      if (this.kind === 'packed' && rel && rel !== basename(this.path)) return;
      const ours = this.recentWrites.get(rel);
      if (ours !== undefined) {
        if (this.stamp(rel) === ours) return;
        this.recentWrites.delete(rel);
      }
      this.pending.add(rel || '*');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const files = [...this.pending];
        this.pending.clear();
        this.notify(files, 'watch');
      }, debounceMs);
    };
    this.watcher =
      this.kind === 'folder'
        ? watch(this.path, { recursive: true }, (_e, f) => onEvent(f))
        : watch(dirname(this.path), (_e, f) => onEvent(f));
    this.watcher.on('error', () => {
      /* folder removed etc.; keep serving the last state */
    });
  }

  stopWatching(): void {
    this.watcher?.close();
    this.watcher = undefined;
    clearTimeout(this.timer);
  }
}
