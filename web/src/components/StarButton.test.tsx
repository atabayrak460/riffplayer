// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarButton } from './StarButton';
import { useFavoritesStore } from '../store/favorites';

// Proves the Vitest/jsdom/@testing-library harness actually works end to
// end (render, user interaction, async state update) — tracked by #2.11.
// Broader component coverage across the app is a separate, larger effort
// (#4.6), deliberately out of scope here.

vi.mock('../api/subsonic', () => ({
  star: vi.fn().mockResolvedValue(undefined),
  unstar: vi.fn().mockResolvedValue(undefined),
}));

const { star, unstar } = await import('../api/subsonic');

beforeEach(() => {
  useFavoritesStore.setState({ starred: {} });
  vi.clearAllMocks();
});

describe('StarButton', () => {
  it('renders unfilled and titled "Add to favourites" when not starred', () => {
    render(<StarButton starred={false} opts={{ id: 't1' }} />);
    const button = screen.getByTitle('Add to favourites');
    expect(button).toBeInTheDocument();
  });

  it('renders filled and titled "Remove from favourites" when starred', () => {
    render(<StarButton starred={true} opts={{ id: 't1' }} />);
    expect(screen.getByTitle('Remove from favourites')).toBeInTheDocument();
  });

  it('exposes its current state as the accessible name', async () => {
    const user = userEvent.setup();
    render(<StarButton starred={false} opts={{ id: 't1' }} />);

    expect(screen.getByRole('button', { name: 'Add to favourites' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to favourites' }));

    expect(screen.getByRole('button', { name: 'Remove from favourites' })).toBeInTheDocument();
  });

  it('clicking toggles to starred, calls the API, and updates optimistically', async () => {
    const user = userEvent.setup();
    render(<StarButton starred={false} opts={{ id: 't1' }} />);

    await user.click(screen.getByTitle('Add to favourites'));

    expect(star).toHaveBeenCalledWith({ id: 't1' });
    expect(screen.getByTitle('Remove from favourites')).toBeInTheDocument();
  });

  it('reverts the optimistic update if the API call fails', async () => {
    vi.mocked(star).mockRejectedValueOnce(new Error('network error'));
    const user = userEvent.setup();
    render(<StarButton starred={false} opts={{ id: 't1' }} />);

    await user.click(screen.getByTitle('Add to favourites'));

    expect(await screen.findByTitle('Add to favourites')).toBeInTheDocument();
  });

  it('clicking an already-starred button calls unstar', async () => {
    const user = userEvent.setup();
    render(<StarButton starred={true} opts={{ albumId: 'al-1' }} />);

    await user.click(screen.getByTitle('Remove from favourites'));

    expect(unstar).toHaveBeenCalledWith({ albumId: 'al-1' });
  });

  it('a second instance for the same item reflects a star made by the first (shared store)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <StarButton starred={false} opts={{ id: 't1' }} />
        <StarButton starred={false} opts={{ id: 't1' }} />
      </>,
    );

    const [first] = screen.getAllByTitle('Add to favourites');
    await user.click(first);

    const titles = screen.getAllByRole('button').map((b) => b.getAttribute('title'));
    expect(titles).toEqual(['Remove from favourites', 'Remove from favourites']);
  });
});
