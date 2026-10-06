/**
 * Running a guided tour: which tour, which step, and the first-run offer (shown once per
 * browser, remembered in localStorage `sbd:tour-offered`). Tours that need a storyboard open
 * the bundled example first when nothing is open (hosted copy, start screen).
 */
import { EXAMPLES } from './examples';
import { app } from './state.svelte';
import { tourById, type Tour, type TourId } from './tours';

const OFFERED = 'sbd:tour-offered';

function wasOffered(): boolean {
  try {
    return localStorage.getItem(OFFERED) !== null;
  } catch {
    return true; // no storage: do not nag on every visit
  }
}

class TourState {
  tour = $state.raw<Tour | null>(null);
  step = $state(0);
  /** The first-run "Take the tour?" card. */
  offer = $state(false);
  /** Where focus was before the tour (restored when it ends). */
  private returnFocus: HTMLElement | null = null;

  /** Shows the first-run offer once per browser (never forced again). */
  maybeOffer(): void {
    if (wasOffered()) return;
    this.offer = true;
    try {
      localStorage.setItem(OFFERED, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  dismissOffer(): void {
    this.offer = false;
  }

  async start(id: TourId | string): Promise<void> {
    const t = tourById(id);
    if (!t) return;
    this.offer = false;
    if (!app.project) {
      const ex = EXAMPLES[0];
      if (ex) await app.openExample(ex);
      if (!app.project) return;
    }
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.step = 0;
    this.tour = t;
  }

  go(i: number): void {
    if (!this.tour) return;
    if (i < 0) return;
    if (i >= this.tour.steps.length) {
      this.stop();
      return;
    }
    this.step = i;
  }

  next(): void {
    this.go(this.step + 1);
  }

  prev(): void {
    this.go(this.step - 1);
  }

  stop(): void {
    this.tour = null;
    this.step = 0;
    const f = this.returnFocus;
    this.returnFocus = null;
    if (f?.isConnected) f.focus();
  }
}

export const tour = new TourState();
