import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylists, createPlaylistWithName, uploadPlaylistCover, deletePlaylist } from '../api/subsonic';
import { PlaylistCard } from '../components/PlaylistCard';

export function PlaylistsPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCoverFile, setNewCoverFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, comment, cover }: { name: string; comment: string; cover: File | null }) => {
      const playlist = await createPlaylistWithName(name, comment || undefined);
      if (cover) {
        // Best-effort: the playlist itself is already created either way, and its
        // cover can always be set later from the playlist detail page.
        await uploadPlaylistCover(playlist.id, cover).catch(() => {});
      }
      return playlist;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      setNewName('');
      setNewDescription('');
      setNewCoverFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setCreating(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlaylist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) {
      createMutation.mutate({ name: newName.trim(), comment: newDescription.trim(), cover: newCoverFile });
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-50">Playlists</h1>
        <button
          onClick={() => setCreating((v) => !v)}
          className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + New playlist
        </button>
      </div>

      {creating && (
        <form onSubmit={submit} className="flex flex-col gap-3 mb-6 max-w-md bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Playlist name"
            autoFocus
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-brand"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-50 placeholder-zinc-500 resize-none focus:outline-none focus:border-brand"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-sm text-zinc-300 hover:text-zinc-50 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 transition-colors"
            >
              {newCoverFile ? 'Change cover…' : 'Choose cover…'}
            </button>
            {newCoverFile && (
              <span className="text-xs text-zinc-400 truncate max-w-[12rem]">{newCoverFile.name}</span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setNewCoverFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending || !newName.trim()}
              className="bg-brand hover:bg-brand-dim text-on-brand text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-zinc-400 hover:text-zinc-50 text-sm px-3 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square bg-zinc-800 rounded-md animate-pulse" />
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <p className="text-zinc-400 text-sm">No playlists yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {playlists.map((pl) => (
            <PlaylistCard key={pl.id} pl={pl} onDelete={() => deleteMutation.mutate(pl.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
