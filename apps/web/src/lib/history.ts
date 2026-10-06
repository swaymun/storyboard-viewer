/**
 * Undo/redo as a stack of immutable states. Each entry stores the state *before* an action and
 * the action's label ("Move shot"). Consecutive actions with the same `coalesce` key within
 * `windowMs` collapse into one entry (dragging a slider, typing into a field).
 */
export interface HistoryEntry<T> {
  state: T;
  label: string;
  key?: string;
  at: number;
}

export class History<T> {
  past: Array<HistoryEntry<T>> = [];
  future: Array<HistoryEntry<T>> = [];

  constructor(
    private readonly limit = 100,
    private readonly windowMs = 1200,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Records that `before` was replaced by an action called `label`. */
  push(before: T, label: string, coalesce?: string): void {
    const t = this.now();
    const last = this.past.at(-1);
    this.future = [];
    if (coalesce && last?.key === coalesce && t - last.at < this.windowMs) {
      last.at = t;
      return;
    }
    const entry: HistoryEntry<T> = { state: before, label, at: t };
    if (coalesce) entry.key = coalesce;
    this.past.push(entry);
    if (this.past.length > this.limit) this.past.shift();
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  /** Returns the state to restore (and its label), moving `current` onto the redo stack. */
  undo(current: T): HistoryEntry<T> | null {
    const e = this.past.pop();
    if (!e) return null;
    this.future.push({ state: current, label: e.label, at: this.now() });
    return e;
  }

  redo(current: T): HistoryEntry<T> | null {
    const e = this.future.pop();
    if (!e) return null;
    this.past.push({ state: current, label: e.label, at: this.now() });
    return e;
  }

  /** Rewrites every stored state (e.g. to rebase history onto changes made by an agent). */
  map(fn: (state: T) => T): void {
    for (const e of [...this.past, ...this.future]) e.state = fn(e.state);
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
