/**
 * App-wide UI state that is not part of the storyboard: which dialogs and panels are open, the
 * open context menu, and a shared asset picker (so menus anywhere can ask for an asset).
 */
import type { AssetKind } from '@storyboard-viewer/format';
import type { MenuItem } from './menu';

export interface ContextMenuState {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  /** Gets focus back when the menu closes with Esc or after a command. */
  returnFocus: HTMLElement | null;
  opened: number;
}

interface PickerRequest {
  kinds: AssetKind[];
  title: string;
  resolve: (id: string | null) => void;
}

function readGuide(): boolean {
  try {
    return localStorage.getItem('sbd:guide-open') === 'true';
  } catch {
    return false;
  }
}

export const GUIDE_WIDTH = { min: 180, max: 480, default: 232 };

function readGuideWidth(): number {
  try {
    const n = Number(localStorage.getItem('sbd:guide-width'));
    if (Number.isFinite(n) && n > 0) return Math.min(GUIDE_WIDTH.max, Math.max(GUIDE_WIDTH.min, n));
  } catch {
    /* not remembered */
  }
  return GUIDE_WIDTH.default;
}

function readShotMore(): boolean {
  try {
    return sessionStorage.getItem('sbd:shot-more') === 'true';
  } catch {
    return false;
  }
}

class Ui {
  settingsOpen = $state(false);
  newOpen = $state(false);
  pdfOpen = $state(false);
  videoOpen = $state(false);
  shortcutsOpen = $state(false);
  aboutOpen = $state(false);
  /**
   * Details, tags and versions of the open shot (card and Board inspector) shown instead of the
   * one-line summary. Starts folded; remembered for the session (`sessionStorage`).
   */
  shotMore = $state(readShotMore());
  /** Soundtrack panel (story-wide cues, tracks with mute/solo/gain) above the playback bar. */
  soundtrackOpen = $state(false);
  contextMenu = $state.raw<ContextMenuState | null>(null);
  /** Commands of the Script view while it is shown (for the menu bar). */
  scriptCommands = $state.raw<{
    makeShot(): void;
    addLineless(): void;
    /** Extends the open shot (or the one next to the selection) to the selected text. */
    extendShot(): void;
  } | null>(null);
  /** Fountain syntax guide (left pane), remembered per browser. */
  guideOpen = $state(readGuide());
  /** Width of the guide pane in px (drag its edge; remembered per browser). */
  guideWidth = $state(readGuideWidth());
  picker = $state.raw<PickerRequest | null>(null);

  setShotMore(open: boolean): void {
    this.shotMore = open;
    try {
      sessionStorage.setItem('sbd:shot-more', String(open));
    } catch {
      /* not remembered */
    }
  }

  /**
   * Opens a context menu at the pointer (mouse event) or next to an element / point (keyboard:
   * Shift+F10 or the Menu key). Calls `preventDefault` on the event.
   */
  openContextMenu(
    at: MouseEvent | KeyboardEvent | { x: number; y: number },
    items: MenuItem[],
    label: string,
    returnFocus: HTMLElement | null = null,
  ): void {
    let x = 0;
    let y = 0;
    if (at instanceof Event) {
      at.preventDefault();
      at.stopPropagation();
      // The Menu key fires keydown and then contextmenu: ignore the second one.
      if (this.contextMenu && Date.now() - this.contextMenu.opened < 200) return;
      const target = at.target as HTMLElement | null;
      if (at instanceof MouseEvent && (at.clientX || at.clientY)) {
        x = at.clientX;
        y = at.clientY;
      } else if (target) {
        const r = target.getBoundingClientRect();
        x = r.left + Math.min(24, r.width / 2);
        y = r.top + Math.min(r.height, 28);
      }
      returnFocus ??= (document.activeElement as HTMLElement | null) ?? target;
    } else {
      x = at.x;
      y = at.y;
      returnFocus ??= document.activeElement as HTMLElement | null;
    }
    this.contextMenu = { x, y, label, items, returnFocus, opened: Date.now() };
  }

  /** Shows or hides the Fountain syntax guide (and remembers it). */
  setGuide(open: boolean): void {
    this.guideOpen = open;
    try {
      localStorage.setItem('sbd:guide-open', String(open));
    } catch {
      /* storage unavailable: it just is not remembered */
    }
  }

  setGuideWidth(px: number, remember = true): void {
    this.guideWidth = Math.round(Math.min(GUIDE_WIDTH.max, Math.max(GUIDE_WIDTH.min, px)));
    if (!remember) return;
    try {
      localStorage.setItem('sbd:guide-width', String(this.guideWidth));
    } catch {
      /* not remembered */
    }
  }

  closeContextMenu(returnFocus: boolean): void {
    const m = this.contextMenu;
    this.contextMenu = null;
    if (returnFocus && m?.returnFocus?.isConnected) m.returnFocus.focus({ preventScroll: true });
  }

  /** Shows the asset picker; resolves with the chosen asset ID (null when cancelled). */
  pickAsset(kinds: AssetKind[], title: string): Promise<string | null> {
    this.picker?.resolve(null);
    return new Promise((resolve) => {
      this.picker = { kinds, title, resolve };
    });
  }

  resolvePicker(id: string | null): void {
    const p = this.picker;
    this.picker = null;
    p?.resolve(id);
  }
}

export const ui = new Ui();

/** Copies text to the clipboard and confirms with a toast-friendly message. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts without the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
