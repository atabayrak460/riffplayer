// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaybackSection } from './PlaybackSection';
import { usePlaybackStore } from '../store/playback';

beforeEach(() => {
  localStorage.clear();
  usePlaybackStore.setState({ replayGain: 'track', preampDb: 0, gapless: true, crossfadeSec: 0 });
});

describe('PlaybackSection', () => {
  it('shows the current settings', () => {
    render(<PlaybackSection />);
    expect(screen.getByRole('radio', { name: /Track/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/Gapless playback/)).toBeChecked();
    expect(screen.getByLabelText(/Crossfade/)).toHaveValue('0');
    expect(screen.getByText('Off', { selector: 'span.text-zinc-400' })).toBeInTheDocument(); // crossfade value
  });

  it('switches the ReplayGain mode', async () => {
    render(<PlaybackSection />);
    await userEvent.click(screen.getByRole('radio', { name: /Album/ }));
    expect(usePlaybackStore.getState().replayGain).toBe('album');
    expect(screen.getByRole('radio', { name: /Album/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('the pre-amp only works while ReplayGain is on', async () => {
    render(<PlaybackSection />);
    const preamp = screen.getByLabelText(/Pre-amp/);
    expect(preamp).toBeEnabled();
    fireEvent.change(preamp, { target: { value: '3' } });
    expect(usePlaybackStore.getState().preampDb).toBe(3);
    expect(screen.getByText('+3 dB')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Off/ }));
    expect(preamp).toBeDisabled();
  });

  it('toggles gapless and sets the crossfade length', async () => {
    render(<PlaybackSection />);
    await userEvent.click(screen.getByLabelText(/Gapless playback/));
    expect(usePlaybackStore.getState().gapless).toBe(false);

    fireEvent.change(screen.getByLabelText(/Crossfade/), { target: { value: '5' } });
    expect(usePlaybackStore.getState().crossfadeSec).toBe(5);
    expect(screen.getByText('5 s')).toBeInTheDocument();
  });
});
