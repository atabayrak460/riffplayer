// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { applyUiStyle, useUiStyleStore, UI_STYLES } from './uiStyle';
import { applyTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.style;
  useUiStyleStore.setState({ style: 'default' });
});

describe('ui style', () => {
  it('default leaves <html> without a data-style attribute', () => {
    applyUiStyle('ipod');
    applyUiStyle('default');
    expect(document.documentElement.hasAttribute('data-style')).toBe(false);
  });

  it('setStyle applies at once and persists', () => {
    useUiStyleStore.getState().setStyle('ipod');
    expect(document.documentElement.dataset.style).toBe('ipod');
    expect(JSON.parse(localStorage.getItem('cadence-ui-style')!).state.style).toBe('ipod');
  });

  it('an unknown stored style falls back to default', async () => {
    localStorage.setItem('cadence-ui-style', JSON.stringify({ state: { style: 'geocities' }, version: 0 }));
    await useUiStyleStore.persist.rehydrate();
    expect(useUiStyleStore.getState().style).toBe('default');
  });

  it('offers the default look and every skin', () => {
    expect(UI_STYLES.map((s) => s.id)).toEqual(['default', 'ipod', 'winamp', 'vista']);
  });

  it('a skin sets its own browser chrome colour, and default hands it back to the theme', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
    const chrome = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content');

    applyUiStyle('winamp');
    expect(document.documentElement.dataset.style).toBe('winamp');
    expect(chrome()).toBe('#1c1d28');

    // a theme change while a skin is active must not overwrite the skin's colour
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
    applyTheme('dark');
    expect(chrome()).toBe('#1c1d28');

    applyUiStyle('default');
    expect(chrome()).toBe('#080e1a');
  });
});
