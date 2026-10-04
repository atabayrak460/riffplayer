// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueuePage } from './QueuePage';
import { usePlayerStore } from '../store/player';
import { useConnectStore } from '../store/connect';
import type { RemoteQueueView } from '../lib/remoteQueue';
import type { Song } from '../api/types';

vi.mock('../components/CoverArt', () => ({ CoverArt: () => null }));

const song = (id: string, extra: Partial<Song> = {}): Song =>
  ({ id, title: `Song ${id}`, artist: `Artist ${id}`, ...extra }) as Song;

const reorderQueue = vi.fn();
const removeFromQueue = vi.fn();
const clearQueue = vi.fn();
const playQueue = vi.fn();

function setQueue(queue: Song[], queueIndex = 0) {
  usePlayerStore.setState({ queue, queueIndex, reorderQueue, removeFromQueue, clearQueue, playQueue });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QueuePage', () => {
  it('shows an empty-state message and no "Clear all" when the queue is empty', () => {
    setQueue([]);
    render(<QueuePage />);

    expect(screen.getByText(/the queue is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
  });

  it('lists every queued song with its artist', () => {
    setQueue([song('a'), song('b')]);
    render(<QueuePage />);

    expect(screen.getByText('Song a')).toBeInTheDocument();
    expect(screen.getByText('Artist b')).toBeInTheDocument();
  });

  it('formats durations as m:ss and shows none when unknown', () => {
    setQueue([song('a', { duration: 65 }), song('b', { duration: 600 }), song('c')]);
    render(<QueuePage />);

    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('highlights only the current track', () => {
    setQueue([song('a'), song('b')], 1);
    render(<QueuePage />);

    expect(screen.getByText('Song b')).toHaveClass('text-brand');
    expect(screen.getByText('Song a')).not.toHaveClass('text-brand');
  });

  it('renders the same song twice when it is queued twice', () => {
    setQueue([song('a'), song('a')]);
    render(<QueuePage />);

    expect(screen.getAllByText('Song a')).toHaveLength(2);
  });

  it('removes by position, so a duplicate removes only the clicked copy', async () => {
    setQueue([song('a'), song('b'), song('a')]);
    render(<QueuePage />);

    const rows = screen.getAllByTitle('Remove');
    await userEvent.click(rows[2]);

    expect(removeFromQueue).toHaveBeenCalledTimes(1);
    expect(removeFromQueue).toHaveBeenCalledWith(2);
  });

  it('plays from the double-clicked position with the whole queue', async () => {
    const queue = [song('a'), song('b'), song('c')];
    setQueue(queue);
    render(<QueuePage />);

    await userEvent.dblClick(screen.getByText('Song c'));

    expect(playQueue).toHaveBeenCalledWith(queue, 2);
  });

  it('a single click does not start playback', async () => {
    setQueue([song('a'), song('b')]);
    render(<QueuePage />);

    await userEvent.click(screen.getByText('Song b'));

    expect(playQueue).not.toHaveBeenCalled();
  });

  it('"Clear all" clears the queue', async () => {
    setQueue([song('a')]);
    render(<QueuePage />);

    await userEvent.click(screen.getByRole('button', { name: /clear all/i }));

    expect(clearQueue).toHaveBeenCalledTimes(1);
  });

  it('gives each row a drag handle', () => {
    setQueue([song('a'), song('b')]);
    render(<QueuePage />);

    expect(within(document.body).getAllByTitle('Drag to reorder')).toHaveLength(2);
  });
});


describe('QueuePage while another device is playing', () => {
  const watchRemoteQueue = vi.fn();
  const playRemoteQueueItem = vi.fn();
  const unwatch = vi.fn();
  const view = (ids: string[], index: number): RemoteQueueView => ({
    version: 1, songs: ids.map((id) => song(id)), positions: ids.map((_, i) => i), index,
  });

  function remoteMode(remoteQueue: RemoteQueueView | null) {
    watchRemoteQueue.mockReturnValue(unwatch);
    useConnectStore.setState({
      status: 'online', deviceId: 'me-device-0001', activeDeviceId: 'phone-device-1',
      devices: [{ id: 'phone-device-1', name: 'Pixel', type: 'android', online: true, unreachable: false, active: true }],
      remoteQueue, watchRemoteQueue, playRemoteQueueItem,
    });
  }

  beforeEach(() => {
    unwatch.mockClear();
    useConnectStore.setState({ status: 'idle', activeDeviceId: null, devices: [], remoteQueue: null });
  });

  it('shows the other device\'s queue (not this device\'s own), says whose it is and highlights its current song', () => {
    setQueue([song('mine')]);
    remoteMode(view(['r1', 'r2'], 1));
    render(<QueuePage />);

    expect(screen.queryByText('Song mine')).not.toBeInTheDocument();
    expect(screen.getByText('On Pixel')).toBeInTheDocument();
    expect(screen.getByText('Song r2')).toHaveClass('text-brand');
    expect(screen.getByText('Song r1')).not.toHaveClass('text-brand');
  });

  it('watches the remote queue while it is shown and stops when the page closes', () => {
    remoteMode(view(['r1'], 0));
    const { unmount } = render(<QueuePage />);
    expect(watchRemoteQueue).toHaveBeenCalledTimes(1);
    unmount();
    expect(unwatch).toHaveBeenCalledTimes(1);
  });

  it('does not watch anything when this device is the player', () => {
    setQueue([song('a')]);
    useConnectStore.setState({ status: 'online', deviceId: 'me-device-0001', activeDeviceId: 'me-device-0001', watchRemoteQueue });
    render(<QueuePage />);
    expect(watchRemoteQueue).not.toHaveBeenCalled();
    expect(screen.getByText('Song a')).toBeInTheDocument();
  });

  it('says it is loading until the queue arrives, with no "Clear all"', () => {
    remoteMode(null);
    render(<QueuePage />);
    expect(screen.getByText(/loading the queue/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
  });

  it('hides "Clear all" even when the other device has a queue', () => {
    remoteMode(view(['r1', 'r2'], 0));
    render(<QueuePage />);
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
  });

  it('does not offer to remove the song that is playing, but does for the others', () => {
    remoteMode(view(['r1', 'r2', 'r3'], 1));
    render(<QueuePage />);
    expect(screen.getAllByTitle('Remove')).toHaveLength(2);
    expect(within(screen.getByText('Song r2').closest('div')!.parentElement!).queryByTitle('Remove')).not.toBeInTheDocument();
  });

  it('removing sends the edit through the player store, and a double click jumps there on the other device', async () => {
    setQueue([]);
    remoteMode(view(['r1', 'r2'], 0));
    render(<QueuePage />);

    await userEvent.click(screen.getAllByTitle('Remove')[0]);
    expect(removeFromQueue).toHaveBeenCalledWith(1); // r1 is playing, so the only button is r2's

    await userEvent.dblClick(screen.getByText('Song r2'));
    expect(playRemoteQueueItem).toHaveBeenCalledWith(1);
    expect(playQueue).not.toHaveBeenCalled();
  });
});
