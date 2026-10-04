// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CoverFlow, coverFlowTransform } from './CoverFlow';
import { usePlayerStore } from '../store/player';
import * as subsonic from '../api/subsonic';
import type { Album, Song } from '../api/types';

vi.mock('./CoverArt', () => ({
  CoverArt: ({ id }: { id?: string }) => <i data-testid="cover" data-id={id} />,
}));

const album = (n: number) =>
  ({ id: `a${n}`, name: `Album ${n}`, artist: `Artist ${n}`, coverArt: `c${n}`, songCount: 1 }) as Album;
const albums = Array.from({ length: 30 }, (_, i) => album(i));

const centre = () =>
  screen.getAllByTestId('coverflow-item').find((e) => e.dataset.offset === '0')!;

function renderFlow(list = albums) {
  return render(
    <MemoryRouter>
      <CoverFlow albums={list} />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe('coverFlowTransform', () => {
  it('faces the centre front and turns the sides away in opposite directions', () => {
    expect(coverFlowTransform(0)).toContain('rotateY(0deg)');
    expect(coverFlowTransform(-2)).toContain('rotateY(58deg)');
    expect(coverFlowTransform(2)).toContain('rotateY(-58deg)');
  });

  it('spreads further covers further out, on the correct side', () => {
    const x = (d: number) => Number(/translateX\((-?[\d.]+)px\)/.exec(coverFlowTransform(d))![1]);
    expect(x(1)).toBeGreaterThan(0);
    expect(x(-1)).toBeLessThan(0);
    expect(x(3)).toBeGreaterThan(x(2));
    expect(x(-3)).toBeLessThan(x(-2));
  });
});

describe('CoverFlow', () => {
  it('shows the first album in the middle with its title and artist', () => {
    renderFlow();
    expect(screen.getByText('Album 0', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Artist 0')).toBeInTheDocument();
    expect(within0(centre()).dataset.id).toBe('c0');
  });

  it('renders only the covers near the middle, not all 30', () => {
    renderFlow();
    expect(screen.getAllByTestId('coverflow-item').length).toBeLessThanOrEqual(8);
  });

  it('arrow keys move through the albums and stop at the ends', () => {
    renderFlow();
    const group = screen.getByRole('group', { name: /Cover Flow/ });
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(screen.getByText('Album 0', { selector: 'p' })).toBeInTheDocument();

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByText('Album 2', { selector: 'p' })).toBeInTheDocument();

    fireEvent.keyDown(group, { key: 'End' });
    expect(screen.getByText('Album 29', { selector: 'p' })).toBeInTheDocument();
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(screen.getByText('Album 29', { selector: 'p' })).toBeInTheDocument();
  });

  it('clicking a side cover brings it to the middle', () => {
    renderFlow();
    const side = screen.getAllByTestId('coverflow-item').find((e) => e.dataset.offset === '2')!;
    fireEvent.click(side);
    expect(screen.getByText('Album 2', { selector: 'p' })).toBeInTheDocument();
    expect(centre().dataset.offset).toBe('0');
  });

  it('the middle cover links to the album', () => {
    renderFlow();
    expect(screen.getByRole('link', { name: 'Open Album 0' })).toHaveAttribute('href', '/albums/a0');
  });

  it('the scrubber jumps straight to an album', () => {
    renderFlow();
    fireEvent.change(screen.getByRole('slider', { name: 'Browse albums' }), { target: { value: '12' } });
    expect(screen.getByText('Album 12', { selector: 'p' })).toBeInTheDocument();
  });

  it('the wheel flips covers', () => {
    renderFlow();
    const group = screen.getByRole('group', { name: /Cover Flow/ });
    fireEvent.wheel(group, { deltaY: 50 });
    expect(screen.getByText('Album 1', { selector: 'p' })).toBeInTheDocument();
    fireEvent.wheel(group, { deltaY: -50 });
    expect(screen.getByText('Album 0', { selector: 'p' })).toBeInTheDocument();
  });

  it('Play queues the centred album', async () => {
    const playQueue = vi.fn();
    usePlayerStore.setState({ playQueue } as never);
    vi.spyOn(subsonic, 'getAlbum').mockResolvedValue({ ...album(1), song: [{ id: 's1' } as Song] } as never);
    renderFlow();
    fireEvent.keyDown(screen.getByRole('group', { name: /Cover Flow/ }), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await vi.waitFor(() => expect(playQueue).toHaveBeenCalled());
    expect(subsonic.getAlbum).toHaveBeenCalledWith('a1');
  });

  it('renders nothing for an empty list', () => {
    const { container } = renderFlow([]);
    expect(container).toBeEmptyDOMElement();
  });
});

function within0(el: HTMLElement) {
  return el.querySelector('[data-testid="cover"]') as HTMLElement;
}
