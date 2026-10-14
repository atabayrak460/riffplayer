import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylists, getPlaylist, addSongToPlaylist, createPlaylistWithName } from '../api/subsonic';
import { useToastStore } from '../store/toast';
import { useDownloadsStore } from '../store/downloads';
import type { Playlist } from '../api/types';
import { Modal } from './Modal';

interface Props {
  songId: string;
  onClose: () => void;
}

export function AddToPlaylistDialog({ songId, onClose }: Props) {
  const qc = useQueryClient();
  const { data: playlists = [], isLoading } = useQuery({ queryKey: ['playlists'], queryFn: getPlaylists });

  const showToast = useToastStore((s) => s.show);

  // Subsonic itself allows duplicate entries, so the check lives here: a
  // song already in the playlist isn't added again, just flagged.
  const addMutation = useMutation({
    mutationFn: async (playlist: Playlist) => {
      const { entry = [] } = await getPlaylist(playlist.id);
      if (entry.some((s) => s.id === songId)) return false;
      await addSongToPlaylist(playlist.id, songId);
      return true;
    },
    onSuccess: (added, playlist) => {
      if (added) {
        qc.invalidateQueries({ queryKey: ['playlist', playlist.id] });
        // A downloaded playlist gets the new song offline too.
        if (useDownloadsStore.getState().playlistState(playlist.id) === 'downloaded') {
          void getPlaylist(playlist.id)
            .then((fresh) => useDownloadsStore.getState().syncPlaylistDownload(fresh, fresh.entry ?? []))
            .catch(() => {});
        }
      }
      else showToast(`Already in "${playlist.name}"`);
      onClose();
    },
  });

  // Previously this dialog could only add to an *existing* playlist — with
  // none yet created, there was no way to get a song into a playlist at all
  // without leaving the dialog, creating one blank from the sidebar, then
  // coming back. The name is asked for, never made up.
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const trimmedName = newName.trim();

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const playlist = await createPlaylistWithName(name);
      await addSongToPlaylist(playlist.id, songId);
      return playlist;
    },
    onSuccess: (playlist) => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist', playlist.id] });
      onClose();
    },
  });

  const busy = addMutation.isPending || createMutation.isPending;

  return (
    <Modal onClose={onClose} label="Add to playlist" className="p-4 w-full max-w-sm max-h-[70vh] flex flex-col">
      {naming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmedName && !busy) createMutation.mutate(trimmedName);
          }}
        >
          <h2 className="text-zinc-50 font-semibold mb-3">New playlist</h2>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Playlist name"
            aria-label="Playlist name"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-50 focus:outline-none focus:border-brand"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={!trimmedName || busy}
              className="px-3 py-1.5 text-sm rounded-md bg-brand text-zinc-950 font-medium disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Back
            </button>
          </div>
        </form>
      ) : (
      <>
      <h2 className="text-zinc-50 font-semibold mb-3">Add to playlist</h2>
      <button
        onClick={() => setNaming(true)}
        disabled={busy || isLoading}
        className="w-full flex items-center gap-2 text-left px-3 py-2 mb-1 text-sm text-brand hover:bg-zinc-700 rounded-md disabled:opacity-50 transition-colors"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New playlist
      </button>
      <div className="overflow-y-auto -mx-1 px-1">
        {isLoading ? (
          <p className="text-xs text-zinc-500 px-2 py-2">Loading…</p>
        ) : playlists.length === 0 ? (
          <p className="text-xs text-zinc-500 px-2 py-2">No playlists yet</p>
        ) : (
          playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => addMutation.mutate(pl)}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 rounded-md truncate disabled:opacity-50 transition-colors"
            >
              {pl.name}
            </button>
          ))
        )}
      </div>
      <button onClick={onClose} className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 self-start">
        Cancel
      </button>
      </>
      )}
    </Modal>
  );
}
