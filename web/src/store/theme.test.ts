// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTheme, resolveTheme, useThemeStore } from './theme';

function mockSystem(light: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: light && q.includes('light'),
    addEventListener() {},
    removeEventListener() {},
  })) as never;
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
  useThemeStore.setState({ mode: 'system' });
  mockSystem(false);
});

describe('theme', () => {
  it('resolves "system" from the OS preference', () => {
    mockSystem(true);
    expect(resolveTheme('system')).toBe('light');
    mockSystem(false);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('an explicit choice ignores the OS preference', () => {
    mockSystem(true);
    expect(resolveTheme('dark')).toBe('dark');
    mockSystem(false);
    expect(resolveTheme('light')).toBe('light');
  });

  it('applyTheme sets <html data-theme> and the browser chrome colour', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#faf7f1');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#080e1a');
  });

  it('setMode applies immediately and persists for the next load', () => {
    useThemeStore.getState().setMode('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    const saved = JSON.parse(localStorage.getItem('cadence-theme')!);
    expect(saved.state.mode).toBe('light');
  });

  it('survives a missing meta tag', () => {
    document.head.innerHTML = '';
    expect(() => applyTheme('dark')).not.toThrow();
    vi.restoreAllMocks();
  });
});
