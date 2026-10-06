import type { IconName } from '../components/Icon.svelte';

/** One entry of a menu (menu bar menus, button menus and context menus share this shape). */
export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Shown on the right ("⌘S"). Display only: the shortcut itself is handled elsewhere. */
  shortcut?: string;
  /** Renders as a checkbox item (or a radio item with `radio`). */
  checked?: boolean;
  radio?: boolean;
  separator?: boolean;
  /** Non-interactive group heading. */
  heading?: boolean;
  /** Opens these items in place of the menu (with a Back item). */
  submenu?: MenuItem[];
  /** Short value shown on the right of a submenu item ("Darkroom"). */
  detail?: string;
  /** Theme ID: shows a small sample of that theme. */
  swatch?: string;
  /** Stable hook for tests/agents (`data-command`). */
  command?: string;
}

/** A top-level menu of the menu bar. */
export interface BarMenu {
  id: string;
  label: string;
  items: MenuItem[];
}

/** Modifier key symbol for shortcut labels: ⌘ on Apple platforms, Ctrl+ elsewhere. */
export const MOD =
  typeof navigator !== 'undefined' && /Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export const sep = (): MenuItem => ({ label: '', separator: true });

/** Keyboard ways to open a context menu: the Menu key or Shift+F10. */
export function isContextMenuKey(e: KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}
