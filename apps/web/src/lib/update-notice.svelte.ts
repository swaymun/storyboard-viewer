/** The "A new version is ready" notice (see sw-update.ts); shown by Toasts.svelte. */
import type { Updater } from './sw-update';

class UpdateNotice {
  show = $state(false);
  /** Reload pressed, saving / switching. */
  busy = $state(false);
  updater: Updater | null = null;

  async reload(): Promise<void> {
    if (!this.updater || this.busy) return;
    this.busy = true;
    try {
      // false: the changes could not be saved (an error toast says why); the notice stays
      await this.updater.reloadNow();
    } finally {
      this.busy = false;
    }
  }
}

export const updateNotice = new UpdateNotice();
