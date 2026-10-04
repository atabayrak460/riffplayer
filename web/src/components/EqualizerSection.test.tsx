// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EqualizerSection } from './EqualizerSection';
import * as equalizerLib from '../lib/equalizer';
import { EQ_PRESETS, useEqualizerStore } from '../store/equalizer';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(equalizerLib, 'equalizerSupported').mockReturnValue(true);
  useEqualizerStore.setState({ enabled: false, gains: [...EQ_PRESETS.Flat], preset: 'Flat' });
});

describe('EqualizerSection', () => {
  it('has ten band sliders', () => {
    render(<EqualizerSection />);
    expect(screen.getAllByRole('slider')).toHaveLength(10);
    expect(screen.getByRole('slider', { name: '1000 Hz' })).toBeInTheDocument();
  });

  it('enables the equalizer and moves a band', async () => {
    render(<EqualizerSection />);
    await userEvent.click(screen.getByLabelText('Enable equalizer'));
    expect(useEqualizerStore.getState().enabled).toBe(true);

    fireEvent.change(screen.getByRole('slider', { name: '62 Hz' }), { target: { value: '5' } });
    expect(useEqualizerStore.getState().gains[1]).toBe(5);
    expect(screen.getByRole('combobox', { name: 'Equalizer preset' })).toHaveValue('Custom');
  });

  it('a preset moves every slider; Reset flattens them', async () => {
    render(<EqualizerSection />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Equalizer preset' }), 'Bass boost');
    expect(screen.getByRole('slider', { name: '31 Hz' })).toHaveValue(String(EQ_PRESETS['Bass boost'][0]));

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('slider', { name: '31 Hz' })).toHaveValue('0');
  });

  it('explains and disables everything when the browser cannot process the audio', () => {
    vi.spyOn(equalizerLib, 'equalizerSupported').mockReturnValue(false);
    render(<EqualizerSection />);
    expect(screen.getByRole('note')).toHaveTextContent(/same address/);
    expect(screen.getByLabelText('Enable equalizer')).toBeDisabled();
    expect(screen.getByRole('slider', { name: '31 Hz' })).toBeDisabled();
  });
});
