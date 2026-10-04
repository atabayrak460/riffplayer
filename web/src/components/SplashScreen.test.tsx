// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// The "already played" flag is module state, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return (await import('./SplashScreen')).SplashScreen;
}

function reducedMotion(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), addEventListener() {}, removeEventListener() {} })) as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion(false);
});
afterEach(() => vi.useRealTimers());

describe('SplashScreen', () => {
  it('shows on a cold start, then fades and unmounts by itself', async () => {
    const SplashScreen = await load();
    render(<SplashScreen />);
    expect(screen.getByTestId('splash')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1300); });
    expect(screen.getByTestId('splash')).toBeInTheDocument(); // fading out

    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });

  it('skips on click', async () => {
    const SplashScreen = await load();
    render(<SplashScreen />);
    fireEvent.click(screen.getByTestId('splash'));
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });

  it('skips on a key press', async () => {
    const SplashScreen = await load();
    render(<SplashScreen />);
    fireEvent.keyDown(window, { key: 'a' });
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });

  it('plays only once per page load, not on a remount', async () => {
    const SplashScreen = await load();
    const first = render(<SplashScreen />);
    first.unmount();
    render(<SplashScreen />);
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });

  it('does not play for people who prefer reduced motion', async () => {
    reducedMotion(true);
    const SplashScreen = await load();
    render(<SplashScreen />);
    expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
  });
});
