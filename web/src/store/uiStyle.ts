import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyTheme, useThemeStore } from './theme';

/** Interface styles: the default look, plus retro skins that re-theme the app
 *  through the same CSS variables (see index.css) and a little extra CSS. */
export const UI_STYLES = [
  { id: 'default', label: 'RiffPlayer', hint: 'The standard look' },
  { id: 'ipod', label: 'iPod Classic', hint: 'Silver, glossy blue, Cover Flow' },
  { id: 'winamp', label: 'Winamp', hint: 'Metal grey, LED green, bevels' },
  { id: 'vista', label: 'Windows Vista', hint: 'Aero glass, glossy blue orb' },
] as const;

export type UiStyle = (typeof UI_STYLES)[number]['id'];

const isUiStyle = (v: unknown): v is UiStyle => UI_STYLES.some((s) => s.id === v);

// Browser / installed-app chrome colour for skins that bring their own palette.
const SKIN_CHROME_COLOR: Partial<Record<UiStyle, string>> = { ipod: '#dfe3ea', winamp: '#1c1d28', vista: '#060e1c' };

/** Writes the style to <html data-style> ('default' = no attribute). */
export function applyUiStyle(style: UiStyle): void {
  if (typeof document === 'undefined') return;
  if (style === 'default') {
    delete document.documentElement.dataset.style;
    applyTheme(useThemeStore.getState().mode); // restores the dark/light chrome colour
  } else {
    document.documentElement.dataset.style = style;
    const color = SKIN_CHROME_COLOR[style];
    if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }
}

interface UiStyleState {
  style: UiStyle;
  setStyle: (style: UiStyle) => void;
}

export const useUiStyleStore = create<UiStyleState>()(
  persist(
    (set) => ({
      style: 'default',
      setStyle: (style) => {
        applyUiStyle(style);
        set({ style });
      },
    }),
    {
      name: 'cadence-ui-style',
      // A style removed in a later version must not strand the app on an unknown value.
      merge: (persisted, current) => {
        const s = (persisted as { style?: unknown } | undefined)?.style;
        return { ...current, style: isUiStyle(s) ? s : 'default' };
      },
    },
  ),
);

/** Call once at startup. */
export function initUiStyle(): void {
  applyUiStyle(useUiStyleStore.getState().style);
}
