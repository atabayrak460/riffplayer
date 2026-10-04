import { useRadioStore } from '../store/radio';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getPlaylist, renamePlaylist, setPlaylistDescription, deletePlaylist,
  reorderPlaylistTracks, uploadPlaylistCover, removePlaylistCover, getPlaylistTrackDates,
} from '../api/subsonic';
import { usePlayerStore } from '../store/player';
import { useDownloadsStore } from '../store/downloads';
import { resolveDragReorderIndices } from '../lib/dragReorder';
import { CoverUploadControl } from '../components/CoverUploadControl';
import { sharePlaylist } from '../lib/share';
import { PlaylistCover } from '../components/StockCovers';
import { SongRow } from '../components/SongRow';
import { DownloadButton } from '../components/DownloadButton';
import { sortPlaylistTracks, type PlaylistSortMode } from '../lib/playlistSort';
import type { Playlist, Song } from '../api/types';

function formatDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

function DraggableSongRow({
  song, index, songs, addedAt,
}: { song: Song; index: number; songs: Song[]; addedAt?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: song.id + '-' + index,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="flex items-center group"
    >
      <button
        {...attributes}
        {...listeners}
        className="px-2 text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9 4a1 1 0 0 1 2 0v16a1 1 0 0 1-2 0V4zm4 0a1 1 0 0 1 2 0v16a1 1 0 0 1-2 0V4z" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <SongRow song={song} queue={songs} index={index + 1} showAlbum addedAt={addedAt} />
      </div>
    </div>
  );
}

export function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const downloadState = useDownloadsStore((s) => (id ? s.playlistState(id) : undefined));
  const requestDownload = useDownloadsStore((s) => s.requestDownload);
  const removePlaylistDownload = useDownloadsStore((s) => s.removePlaylistDownload);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [sortMode, setSortMode] = useState<PlaylistSortMode>('custom');

  const { data: playlist, isLoading } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => getPlaylist(id!),
    enabled: !!id,
  });

  // Also drives the "date added" column on every row, not just the sort toggle —
  // switching sort views itself is purely a client-side transform and never
  // touches the saved custom order.
  const { data: trackDates } = useQuery({
    queryKey: ['playlist-track-dates', id],
    queryFn: () => getPlaylistTrackDates(id!),
    enabled: !!id,
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => renamePlaylist(id!, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlist', id] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      setEditingName(false);
    },
  });

  const descriptionMutation = useMutation({
    mutationFn: (comment: string) => setPlaylistDescription(id!, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlist', id] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      setEditingDescription(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlaylist(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      navigate('/playlists');
    },
  });

  const reorderMutation = useMutation({
    mutationFn: ({ trackIds }: { trackIds: string[]; reordered: Song[] }) =>
      reorderPlaylistTracks(id!, trackIds),
    // Writes the new order into the cache immediately, rather than waiting
    // for the round-trip to resolve — otherwise the drop visibly reverts to
    // the old order for a beat before refetch. It also means a second drag
    // started before this one settles reads the already-reordered list (via
    // the `songs` closure below, refreshed by the re-render this triggers)
    // instead of a stale pre-drag snapshot, so it can no longer silently
    // undo the first reorder.
    onMutate: async ({ reordered }) => {
      await qc.cancelQueries({ queryKey: ['playlist', id] });
      const previousPlaylist = qc.getQueryData<Playlist>(['playlist', id]);
      qc.setQueryData<Playlist | undefined>(['playlist', id], (old) =>
        old ? { ...old, entry: reordered } : old,
      );
      return { previousPlaylist };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousPlaylist) qc.setQueryData(['playlist', id], context.previousPlaylist);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlist', id] }),
  });

  const coverMutation = useMutation({
    mutationFn: (file: File) => uploadPlaylistCover(id!, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlist', id] }),
  });
  const removeCoverMutation = useMutation({
    mutationFn: () => removePlaylistCover(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlist', id] }),
  });
  const coverError = coverMutation.isError
    ? coverMutation.error instanceof Error
      ? coverMutation.error.message
      : 'Upload failed'
    : null;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (isLoading) {
    return <div className="p-6 text-zinc-400 text-sm">Loading…</div>;
  }
  if (!playlist) {
    return <div className="p-6 text-red-400 text-sm">Playlist not found.</div>;
  }

  const songs = playlist.entry ?? [];
  const songIds = songs.map((s, i) => s.id + '-' + i);

  const displayedSongs = sortPlaylistTracks(songs, trackDates, sortMode);

  const onDragEnd = (event: DragEndEvent) => {
    const resolved = resolveDragReorderIndices(songIds, String(event.active.id), event.over ? String(event.over.id) : undefined);
    if (!resolved) return;
    const reordered = [...songs];
    const [moved] = reordered.splice(resolved.from, 1);
    reordered.splice(resolved.to, 0, moved);
    reorderMutation.mutate({ trackIds: reordered.map((s) => s.id), reordered });
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6">
        <CoverUploadControl
          coverId={playlist.coverArt}
          coverSize={440}
          coverClassName="w-40 h-40 sm:w-56 sm:h-56 rounded-lg object-cover shadow-xl"
          alt={playlist.name}
          fallback={<PlaylistCover className="w-full h-full" />}
          shape="square"
          hasCover={!!playlist.coverArt?.startsWith('pl-')}
          uploadTitle="Upload cover"
          removeTitle="Reset to default cover"
          onUpload={(file) => coverMutation.mutate(file)}
          onRemove={() => removeCoverMutation.mutate()}
          error={coverError}
        />

        <div className="flex flex-col flex-1 min-w-0 sm:h-56">
          <p className="text-xs uppercase tracking-widest text-zinc-400">Playlist</p>
          {editingName ? (
            <form
              onSubmit={(e) => { e.preventDefault(); renameMutation.mutate(nameValue); }}
              className="flex gap-2 mt-1"
            >
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-50 text-3xl font-bold focus:outline-none focus:border-brand"
              />
              <button type="submit" className="text-brand text-sm self-center">Save</button>
              <button type="button" onClick={() => setEditingName(false)} className="text-zinc-400 text-sm self-center">Cancel</button>
            </form>
          ) : (
            <h1
              className="text-3xl font-bold text-zinc-50 cursor-pointer hover:text-brand transition-colors mt-1 truncate"
              onClick={() => { setNameValue(playlist.name); setEditingName(true); }}
              title="Click to rename"
            >
              {playlist.name}
            </h1>
          )}
          <p className="text-sm text-zinc-400 mt-1.5">
            {playlist.owner} · {songs.length} {songs.length === 1 ? 'track' : 'tracks'}
            {songs.length > 0 && ` · ${formatDuration(playlist.duration)}`}
          </p>

          {editingDescription ? (
            <form
              onSubmit={(e) => { e.preventDefault(); descriptionMutation.mutate(descriptionValue); }}
              className="flex flex-col gap-1.5 mt-3 flex-1 min-h-0"
            >
              <textarea
                autoFocus
                value={descriptionValue}
                onChange={(e) => setDescriptionValue(e.target.value)}
                placeholder="Add a description…"
                className="bg-zinc-900/50 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-50 text-sm resize-none focus:outline-none focus:border-brand flex-1 min-h-0"
              />
              <div className="flex gap-2">
                <button type="submit" className="text-brand text-sm">Save</button>
                <button type="button" onClick={() => setEditingDescription(false)} className="text-zinc-400 text-sm">Cancel</button>
              </div>
            </form>
          ) : (
            <div
              className="mt-3 flex-1 min-h-0 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 overflow-y-auto cursor-pointer hover:border-zinc-700 transition-colors"
              onClick={() => { setDescriptionValue(playlist.comment ?? ''); setEditingDescription(true); }}
              title="Click to edit description"
            >
              <p className="text-sm text-zinc-400 whitespace-pre-wrap break-words">
                {playlist.comment || <span className="italic text-zinc-600">No description</span>}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-8">
        <button
          onClick={() => playQueue(displayedSongs)}
          disabled={!songs.length}
          className="bg-brand hover:bg-brand-dim text-on-brand text-sm font-medium px-5 py-2 rounded-full transition-colors disabled:opacity-50"
        >
          Play
        </button>
        <DownloadButton
          state={downloadState}
          onDownload={() => requestDownload({ kind: 'playlist', playlist, songs })}
          onRemove={() => removePlaylistDownload(playlist.id)}
        />
        <button
          onClick={() => void useRadioStore.getState().start({ type: 'playlist', id: playlist.id, name: playlist.name })}
          disabled={!songs.length}
          className="text-zinc-400 hover:text-zinc-50 transition-colors text-sm disabled:opacity-50"
        >
          Radio
        </button>
        <button
          onClick={() => void sharePlaylist(playlist)}
          className="text-zinc-400 hover:text-zinc-50 transition-colors text-sm"
        >
          Share as picture
        </button>
        <button
          onClick={() => { if (confirm(`Delete "${playlist.name}"?`)) deleteMutation.mutate(); }}
          className="text-zinc-400 hover:text-red-400 transition-colors text-sm"
        >
          Delete
        </button>
      </div>

      {/* Sort control — a display transform only; never mutates the saved custom order */}
      {songs.length > 0 && (
        <div className="flex items-center gap-1 mb-3">
          {([
            ['custom', 'Custom order'],
            ['addedAsc', 'Date added: oldest first'],
            ['addedDesc', 'Date added: newest first'],
          ] as [PlaylistSortMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                sortMode === mode ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Track list — draggable only in custom-order mode */}
      {songs.length === 0 ? (
        <p className="text-zinc-400 text-sm">No tracks yet.</p>
      ) : sortMode === 'custom' ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={songIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-0.5">
              {songs.map((song, i) => (
                <DraggableSongRow
                  key={song.id + '-' + i}
                  song={song}
                  index={i}
                  songs={songs}
                  addedAt={trackDates?.[song.id]}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="space-y-0.5">
          {displayedSongs.map((song, i) => (
            <SongRow
              key={song.id}
              song={song}
              queue={displayedSongs}
              index={i + 1}
              showAlbum
              addedAt={trackDates?.[song.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
