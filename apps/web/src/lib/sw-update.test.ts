import { describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import {
  CHECK_INTERVAL,
  MIN_CHECK_GAP,
  SWITCH_TIMEOUT,
  startUpdater,
  updateAction,
  type WorkState,
} from './sw-update';

describe('updateAction', () => {
  it('reloads by itself only when nothing can be lost', () => {
    expect(updateAction({ unsaved: false, saving: false })).toBe('reload');
    expect(updateAction({ unsaved: true, saving: false })).toBe('ask');
    expect(updateAction({ unsaved: false, saving: true })).toBe('ask');
    // a file opened in the browser would be closed by a reload
    expect(updateAction({ unsaved: false, saving: false, openLocal: true })).toBe('ask');
    expect(updateAction({ unsaved: false, saving: false, openLocal: false })).toBe('reload');
  });
});

/** startUpdater with a fake registerSW, registration, timers and events. */
function setup(work: Partial<WorkState> & { saveWorks?: boolean } = {}) {
  const state = { unsaved: false, saving: false, openLocal: false, ...work };
  const save = vi.fn<() => Promise<void>>(async () => {
    if (work.saveWorks !== false) state.unsaved = false;
  });
  let options!: RegisterSWOptions;
  const updateSW = vi.fn<(reload?: boolean) => Promise<void>>(async () => {});
  const registration = {
    installing: null as unknown,
    waiting: {} as unknown,
    update: vi.fn<() => Promise<void>>(async () => {}),
  };
  const notices: boolean[] = [];
  const reload = vi.fn<() => void>();
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let clock = 0;
  const intervals: Array<[() => void, number]> = [];
  const timeouts: Array<[() => void, number]> = [];
  const updater = startUpdater({
    registerSW: (o) => {
      options = o;
      return updateSW;
    },
    work: {
      get unsaved() {
        return state.unsaved;
      },
      get saving() {
        return state.saving;
      },
      get openLocal() {
        return state.openLocal;
      },
      save,
    },
    notify: (show) => notices.push(show),
    reload,
    win,
    doc,
    now: () => clock,
    setInterval: (fn, ms) => intervals.push([fn, ms]),
    setTimeout: (fn, ms) => timeouts.push([fn, ms]),
  });
  options.onRegisteredSW?.('/sw.js', registration as unknown as ServiceWorkerRegistration);
  return {
    state,
    save,
    options,
    updateSW,
    registration,
    notices,
    reload,
    win,
    doc,
    updater,
    intervals,
    timeouts,
    tick: (ms: number) => (clock += ms),
  };
}

describe('startUpdater', () => {
  it('registers at once and checks on load, focus, visibility, online and every 30 min', () => {
    const t = setup();
    expect(t.options.immediate).toBe(true);
    expect(t.registration.update).toHaveBeenCalledTimes(1); // on load
    expect(t.intervals).toEqual([[expect.any(Function), CHECK_INTERVAL]]);
    t.tick(MIN_CHECK_GAP);
    t.win.dispatchEvent(new Event('focus'));
    expect(t.registration.update).toHaveBeenCalledTimes(2);
    // a burst of events: one check
    t.doc.dispatchEvent(new Event('visibilitychange'));
    t.win.dispatchEvent(new Event('focus'));
    expect(t.registration.update).toHaveBeenCalledTimes(2);
    t.tick(MIN_CHECK_GAP);
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.registration.update).toHaveBeenCalledTimes(3);
    t.win.dispatchEvent(new Event('online'));
    expect(t.registration.update).toHaveBeenCalledTimes(4);
    t.intervals[0]![0]();
    expect(t.registration.update).toHaveBeenCalledTimes(5);
  });

  it('a new version with nothing unsaved: switches and reloads without asking', () => {
    const t = setup();
    t.options.onNeedRefresh?.();
    expect(t.updateSW).toHaveBeenCalledWith(true);
    expect(t.notices).not.toContain(true);
    // the new worker took over: reload
    t.options.onNeedReload?.();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when the page is not controlled (no controlling event)', () => {
    const t = setup();
    t.options.onNeedRefresh?.();
    expect(t.timeouts).toEqual([[t.reload, SWITCH_TIMEOUT]]);
  });

  it('a new version with unsaved changes: asks, never reloads by itself', () => {
    const t = setup({ unsaved: true });
    t.options.onNeedRefresh?.();
    expect(t.updateSW).not.toHaveBeenCalled();
    expect(t.notices).toEqual([true]);
    expect(t.updater.pending).toBe(true);
    // another tab switched to the new version: this one keeps its work
    t.options.onNeedReload?.();
    expect(t.reload).not.toHaveBeenCalled();
    // hidden but still unsaved: nothing happens
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.updateSW).not.toHaveBeenCalled();
  });

  it('asks while a save is running, and when a local file is open', () => {
    for (const work of [{ saving: true }, { openLocal: true }]) {
      const t = setup(work);
      t.options.onNeedRefresh?.();
      expect(t.notices).toEqual([true]);
      expect(t.updateSW).not.toHaveBeenCalled();
    }
  });

  it('Reload saves first, then switches', async () => {
    const t = setup({ unsaved: true });
    t.options.onNeedRefresh?.();
    expect(await t.updater.reloadNow()).toBe(true);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.updateSW).toHaveBeenCalledWith(true);
    expect(t.notices).toEqual([true, false]);
    t.options.onNeedReload?.();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('Reload does not switch when saving failed or was cancelled', async () => {
    const t = setup({ unsaved: true, saveWorks: false });
    t.options.onNeedRefresh?.();
    expect(await t.updater.reloadNow()).toBe(false);
    expect(t.updateSW).not.toHaveBeenCalled();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('Reload with a local file open (nothing unsaved) switches without saving', async () => {
    const t = setup({ openLocal: true });
    t.options.onNeedRefresh?.();
    expect(await t.updater.reloadNow()).toBe(true);
    expect(t.save).not.toHaveBeenCalled();
    expect(t.updateSW).toHaveBeenCalledWith(true);
  });

  it('Reload after another tab already switched: just reloads', async () => {
    const t = setup({ unsaved: true });
    t.options.onNeedRefresh?.();
    t.registration.waiting = null;
    t.options.onNeedReload?.();
    expect(t.reload).not.toHaveBeenCalled();
    await t.updater.reloadNow();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('switches when the tab is hidden after the work was saved', () => {
    const t = setup({ unsaved: true });
    t.options.onNeedRefresh?.();
    t.state.unsaved = false;
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(t.updateSW).toHaveBeenCalledWith(true);
  });
});
