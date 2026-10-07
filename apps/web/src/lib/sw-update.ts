/**
 * Getting new versions of the app to the user (service worker updates).
 *
 * The service worker precaches the app, so a deploy only reaches an open tab once the new worker
 * takes over. It is built in "prompt" mode: a new worker waits until the page sends it
 * SKIP_WAITING (`updateSW(true)`), and the page reloads when the new worker controls it.
 *
 * - Checks for a new version when the page loads, when the window gets focus or becomes
 *   visible again, when the network comes back, and every 30 minutes.
 * - A new version is waiting: with nothing unsaved, switch and reload at once; with unsaved
 *   changes (or a save running), show "A new version is ready — Reload" instead. Reload saves
 *   first and only switches when everything is saved. Also asked (never reloaded by itself):
 *   a file or folder opened in the browser, which a reload would close. A tab that becomes
 *   clean later switches when it is hidden (the user does not see it).
 * - Another tab of the app switched to the new version: this tab reloads only when nothing can
 *   be lost; otherwise it keeps the notice.
 *
 * Plain TypeScript with injected dependencies, so the decisions are unit-tested
 * (sw-update.test.ts) and the e2e test swaps real builds (e2e/updates.spec.ts).
 */
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

/** Periodic update check. */
export const CHECK_INTERVAL = 30 * 60_000;
/** Focus and visibility events come in bursts: at most one check per this many ms. */
export const MIN_CHECK_GAP = 3_000;
/** After asking the new worker to take over: reload anyway if nothing happened by then. */
export const SWITCH_TIMEOUT = 4_000;

/** What the editor knows about the user's work. */
export interface WorkState {
  /** Changes not on disk yet (typed text that is not an edit yet included). */
  readonly unsaved: boolean;
  /** A save is running. */
  readonly saving: boolean;
  /**
   * A storyboard is open that does not come back by itself after a reload (a file or folder
   * opened in the browser; `sbd serve` reconnects).
   */
  readonly openLocal?: boolean;
}

export type UpdateAction = 'reload' | 'ask';

/**
 * A new version is waiting: reload by itself only when nothing can be lost and the user gets back
 * to where they were; otherwise ask.
 */
export function updateAction(work: WorkState): UpdateAction {
  return work.unsaved || work.saving || work.openLocal ? 'ask' : 'reload';
}

/** Whether Reload has to save first. */
export const mustSave = (work: WorkState): boolean => work.unsaved || work.saving;

type RegisterSW = (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

export interface UpdaterDeps {
  /** `registerSW` from `virtual:pwa-register`. */
  registerSW: RegisterSW;
  work: WorkState & { save(): Promise<void> };
  /** Shows (true) or hides (false) the "A new version is ready" notice. */
  notify(show: boolean): void;
  /** Reloads the page (default: `location.reload()`). */
  reload?: () => void;
  /** Window events (focus, online); default: `window`. */
  win?: EventTarget;
  /** Document events and state (visibilitychange); default: `document`. */
  doc?: EventTarget & { readonly visibilityState: string };
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export interface Updater {
  /** Looks for a new version now (rate-limited unless `force`). */
  check(force?: boolean): Promise<void>;
  /** The notice's Reload: saves first; switches only when nothing is left unsaved. */
  reloadNow(): Promise<boolean>;
  /** A new version is waiting for this tab. */
  readonly pending: boolean;
}

export function startUpdater(deps: UpdaterDeps): Updater {
  const { work, notify } = deps;
  const reload = deps.reload ?? (() => location.reload());
  const win = deps.win ?? window;
  const doc = deps.doc ?? document;
  const now = deps.now ?? Date.now;
  const every = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));

  let registration: ServiceWorkerRegistration | undefined;
  let pending = false;
  /** This tab asked the new worker to take over (or the user pressed Reload). */
  let switching = false;
  let lastCheck = -Infinity;

  const check = async (force = false): Promise<void> => {
    if (!registration || registration.installing) return;
    if (!force && now() - lastCheck < MIN_CHECK_GAP) return;
    lastCheck = now();
    try {
      await registration.update();
    } catch {
      /* offline or the server is down: try again later */
    }
  };

  const activate = (): void => {
    switching = true;
    notify(false);
    if (registration && !registration.waiting) {
      // already active (another tab switched it), this page just runs old code
      reload();
      return;
    }
    void updateSW(true);
    // `controlling` reloads the page; if the page is not controlled (opened with a hard
    // reload) it never fires, so reload anyway.
    later(reload, SWITCH_TIMEOUT);
  };

  const onNeedRefresh = (): void => {
    pending = true;
    if (updateAction(work) === 'reload') activate();
    else notify(true);
  };

  // The new worker controls this page now (this tab or another one asked for it).
  const onNeedReload = (): void => {
    if (switching || updateAction(work) === 'reload') {
      reload();
      return;
    }
    pending = true;
    notify(true);
  };

  const updateSW = deps.registerSW({
    immediate: true,
    onNeedRefresh,
    onNeedReload,
    onRegisteredSW(_url, r) {
      registration = r;
      if (!r) return;
      void check(true);
      every(() => void check(true), CHECK_INTERVAL);
    },
  });

  win.addEventListener('focus', () => void check());
  win.addEventListener('online', () => void check(true));
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') void check();
    // waiting while the user worked; clean now and out of sight: switch without disturbing
    else if (pending && !switching && updateAction(work) === 'reload') activate();
  });

  return {
    check,
    async reloadNow() {
      if (mustSave(work)) {
        await work.save();
        if (mustSave(work)) return false; // not saved (cancelled or failed)
      }
      activate();
      return true;
    },
    get pending() {
      return pending;
    },
  };
}
