import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

// Matches the page background of each theme (--c-950); used for the browser /
// installed-app chrome via <meta name="theme-color">.
const CHROME_COLOR: Record<ResolvedTheme, string> = { dark: '#080e1a', light: '#faf7f1' };

const prefersLight = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: light)').matches;

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return prefersLight() ? 'light' : 'dark';
  return mode;
}

/** Writes the resolved theme to <html data-theme> (which switches the CSS variables). */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  // A skin with its own palette keeps its own chrome colour (see uiStyle.ts).
  if (!document.documentElement.dataset.style) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME_COLOR[resolved]);
  }
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

/** Dark / light / follow-the-system, persisted. index.html applies the stored
 *  value before first paint (no flash); this keeps it in sync afterwards. */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      setMode: (mode) => {
        applyTheme(mode);
        set({ mode });
      },
    }),
    { name: 'cadence-theme' },
  ),
);

/** Call once at startup: applies the stored mode and follows OS changes while in 'system'. */
export function initTheme(): void {
  applyTheme(useThemeStore.getState().mode);
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (useThemeStore.getState().mode === 'system') applyTheme('system');
  });
}
