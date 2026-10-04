// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSection } from './AppearanceSection';
import { useThemeStore } from '../store/theme';
import { useUiStyleStore } from '../store/uiStyle';

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  useThemeStore.setState({ mode: 'system' });
  useUiStyleStore.setState({ style: 'default' });
  delete document.documentElement.dataset.style;
});

describe('AppearanceSection', () => {
  it('marks the current mode and switches theme on click', async () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: /Light/ }));

    expect(useThemeStore.getState().mode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches the interface style and explains that the theme does not apply to it', async () => {
    render(<AppearanceSection />);
    expect(screen.queryByText(/has its own colours/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /iPod Classic/ }));

    expect(useUiStyleStore.getState().style).toBe('ipod');
    expect(document.documentElement.dataset.style).toBe('ipod');
    expect(screen.getByText(/has its own colours/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /RiffPlayer/ }));
    expect(document.documentElement.hasAttribute('data-style')).toBe(false);
  });
});
