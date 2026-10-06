/**
 * Appearance: the chosen theme ("system" or a theme ID) and, for "system", the light/dark pair
 * it switches between. Stored in localStorage; applied as `data-theme` on <html>. index.html runs
 * the same resolution before the first paint so there is no flash of the wrong theme.
 */
import {
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  THEMES,
  THEME_KEY,
  THEME_PAIR_KEY,
  type ThemeDef,
} from './theme-list';

export { THEMES, type ThemeDef };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode, blocked storage: the choice lasts for this session only */
  }
}

const known = (id: string | null | undefined, kind?: 'light' | 'dark') =>
  !!id && THEMES.some((t) => t.id === id && (!kind || t.kind === kind));

class ThemeState {
  choice = $state<string>('system');
  light = $state<string>(DEFAULT_LIGHT);
  dark = $state<string>(DEFAULT_DARK);
  private prefersDark = $state(false);

  resolved = $derived(
    this.choice === 'system' ? (this.prefersDark ? this.dark : this.light) : this.choice,
  );
  current = $derived(THEMES.find((t) => t.id === this.resolved) ?? THEMES[0]!);

  init(): void {
    const c = read(THEME_KEY);
    this.choice = c === 'system' || known(c) ? c! : 'system';
    try {
      const pair = JSON.parse(read(THEME_PAIR_KEY) ?? '{}') as { light?: string; dark?: string };
      if (known(pair.light, 'light')) this.light = pair.light!;
      if (known(pair.dark, 'dark')) this.dark = pair.dark!;
    } catch {
      /* ignore */
    }
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    this.prefersDark = !!mq?.matches;
    mq?.addEventListener('change', (e) => {
      this.prefersDark = e.matches;
      this.apply();
    });
    this.apply();
  }

  set(choice: string): void {
    if (choice !== 'system' && !known(choice)) return;
    this.choice = choice;
    write(THEME_KEY, choice);
    this.apply();
  }

  setPair(kind: 'light' | 'dark', id: string): void {
    if (!known(id, kind)) return;
    this[kind] = id;
    write(THEME_PAIR_KEY, JSON.stringify({ light: this.light, dark: this.dark }));
    this.apply();
  }

  /** CSS custom property of the current theme (canvas and waveform drawing). */
  token(name: string, fallback = ''): string {
    if (typeof document === 'undefined') return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  private apply(): void {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    el.dataset['theme'] = this.resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    // Next frame: computed styles reflect the new data-theme.
    requestAnimationFrame(() => meta?.setAttribute('content', this.token('--surface')));
  }
}

export const theme = new ThemeState();
