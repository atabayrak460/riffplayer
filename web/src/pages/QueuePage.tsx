import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect } from 'react';
import { usePlayerStore } from '../store/player';
import { useConnectStore } from '../store/connect';
import { CoverArt } from '../components/CoverArt';
import { resolveDragReorderIndices } from '../lib/dragReorder';
import type { Song } from '../api/types';

function formatDuration(s?: number) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface QueueItemProps {
  song: Song;
  index: number;
  isCurrent: boolean;
  /** Removing the song that is playing on another device would stop it there, so that isn't offered. */
  canRemove?: boolean;
  onRemove: () => void;
  onPlay: () => void;
}

function QueueItem({ song, index, isCurrent, canRemove = true, onRemove, onPlay }: QueueItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${song.id}-${index}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-2 rounded-md group ${isCurrent ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
        title="Drag to reorder"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9 4a1 1 0 0 1 2 0v16a1 1 0 0 1-2 0V4zm4 0a1 1 0 0 1 2 0v16a1 1 0 0 1-2 0V4z" />
        </svg>
      </button>

      <CoverArt
        id={song.coverArt}
        size={48}
        className="w-10 h-10 rounded flex-shrink-0 object-cover cursor-pointer"
        alt={song.title}
      />

      <div className="flex-1 min-w-0 cursor-pointer" onDoubleClick={onPlay}>
        <p className={`text-sm font-medium truncate ${isCurrent ? 'text-brand' : 'text-white'}`}>
          {song.title}
        </p>
        <p className="text-xs text-zinc-400 truncate">{song.artist}</p>
      </div>

      <span className="text-xs text-zinc-500 flex-shrink-0">{formatDuration(song.duration)}</span>

      {canRemove && <button
        onClick={onRemove}
        title="Remove"
        className="text-zinc-600 hover:text-red-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>}
    </div>
  );
}

export function QueuePage() {
  const localQueue = usePlayerStore((s) => s.queue);
  const localIndex = usePlayerStore((s) => s.queueIndex);
  // While another device is the one playing, this page shows and edits *its* queue.
  const remoteActive = useConnectStore((s) => s.status === 'online' && s.activeDeviceId !== null && s.activeDeviceId !== s.deviceId);
  const remoteQueue = useConnectStore((s) => s.remoteQueue);
  const remoteDevice = useConnectStore((s) => s.devices.find((d) => d.id === s.activeDeviceId));
  const watchRemoteQueue = useConnectStore((s) => s.watchRemoteQueue);
  const playRemoteQueueItem = useConnectStore((s) => s.playRemoteQueueItem);
  useEffect(() => (remoteActive ? watchRemoteQueue() : undefined), [remoteActive, watchRemoteQueue]);

  const queue = remoteActive ? (remoteQueue?.songs ?? []) : localQueue;
  const queueIndex = remoteActive ? (remoteQueue?.index ?? -1) : localIndex;
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Use index-qualified IDs so duplicate songs in the queue sort correctly
  const itemIds = queue.map((s, i) => `${s.id}-${i}`);

  const onDragEnd = (event: DragEndEvent) => {
    const resolved = resolveDragReorderIndices(itemIds, String(event.active.id), event.over ? String(event.over.id) : undefined);
    if (resolved) reorderQueue(resolved.from, resolved.to);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Queue</h1>
          {remoteActive && remoteDevice && <p className="text-xs text-brand">On {remoteDevice.name}</p>}
        </div>
        {queue.length > 0 && !remoteActive && (
          <button
            onClick={clearQueue}
            className="text-sm text-zinc-400 hover:text-red-400 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <p className="text-zinc-400 text-sm">
          {remoteActive && !remoteQueue ? 'Loading the queue…' : 'The queue is empty. Double-click a song to start playing.'}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-0.5">
              {queue.map((song, i) => (
                <QueueItem
                  key={`${song.id}-${i}`}
                  song={song}
                  index={i}
                  isCurrent={i === queueIndex}
                  canRemove={!(remoteActive && i === queueIndex)}
                  onRemove={() => removeFromQueue(i)}
                  onPlay={() => (remoteActive ? playRemoteQueueItem(i) : playQueue(queue, i))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
