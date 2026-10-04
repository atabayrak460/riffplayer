import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  pinLibraryItem, unpinLibraryItem, recordLibraryInteraction, type LibraryItemType,
} from '../api/subsonic';
import { ContextMenu, useContextMenu } from './ContextMenu';
import { CoverArt } from './CoverArt';
import { PlaylistCover } from './StockCovers';

interface Props {
  to: string;
  label: string;
  itemType: LibraryItemType;
  itemKey: string;
  pinned: boolean;
  /** Playlist rows: real cover id, if any (falls back to the stock Playlist SVG). */
  coverArt?: string;
  /** System-view rows: which stock SVG represents this view. */
  StockCover?: ComponentType<{ className?: string }>;
}

const PIN_ICON = 'M12 2a5 5 0 0 0-5 5c0 3.5 5 10 5 10s5-6.5 5-10a5 5 0 0 0-5-5z';

export function SidebarLibraryItem({ to, label, itemType, itemKey, pinned, coverArt, StockCover }: Props) {
  const qc = useQueryClient();
  const { menu, handlers, close } = useContextMenu();

  const invalidate = () => qc.invalidateQueries({ queryKey: ['library-sidebar-state'] });
  const pinMutation = useMutation({ mutationFn: () => pinLibraryItem(itemType, itemKey), onSuccess: invalidate });
  const unpinMutation = useMutation({ mutationFn: () => unpinLibraryItem(itemType, itemKey), onSuccess: invalidate });

  const interact = () => {
    recordLibraryInteraction(itemType, itemKey).then(invalidate).catch(() => {/* best-effort */});
  };

  const contextItems = pinned
    ? [{ label: 'Unpin', onClick: () => unpinMutation.mutate() }]
    : [{ label: 'Pin', onClick: () => pinMutation.mutate() }];

  return (
    <>
      <NavLink
        to={to}
        onClick={interact}
        {...handlers(contextItems)}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
            isActive ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800/50'
          }`
        }
      >
        <div className="w-10 h-10 rounded-sm overflow-hidden flex-shrink-0">
          {itemType === 'playlist' ? (
            <CoverArt
              id={coverArt}
              size={80}
              className="w-full h-full object-cover"
              alt={label}
              fallback={<PlaylistCover className="w-full h-full" />}
            />
          ) : (
            StockCover && <StockCover className="w-full h-full" />
          )}
        </div>
        <span className="truncate flex-1">{label}</span>
        {pinned && (
          <svg className="w-3 h-3 text-zinc-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d={PIN_ICON} />
          </svg>
        )}
      </NavLink>
      <ContextMenu menu={menu} onClose={close} />
    </>
  );
}
