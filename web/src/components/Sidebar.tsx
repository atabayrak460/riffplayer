import { useRef } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { usePanelSizesStore, SIDEBAR_MIN, SIDEBAR_MAX } from '../store/panelSizes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminGetSettings, getPlaylists, createPlaylistWithName, getLibrarySidebarState,
} from '../api/subsonic';
import { SidebarLibraryItem } from './SidebarLibraryItem';
import { ResizeHandle } from './ResizeHandle';
import { orderLibraryRows, type LibraryRow } from '../lib/librarySidebarOrder';
import {
  FavouritesCover, RecentlyPlayedCover, MostPlayedCover, DownloadedCover, DiscoverCover, WrappedCover, AllSongsCover,
} from './StockCovers';

// Fixed top section — always in this order, never reordered. All Songs
// lives in the pinnable Library list below instead (same key, 'all-songs',
// as the mobile app's library_screen.dart — mobile never had it as a
// separate top-level tab in the first place, only ever as a Library item).
const TOP_NAV = [
  { to: '/home', label: 'Home', icon: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25' },
  { to: '/albums', label: 'Albums', icon: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z' },
  { to: '/artists', label: 'Artists', icon: 'M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z' },
  { to: '/search', label: 'Search', icon: 'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z' },
  { to: '/queue', label: 'Queue', icon: 'M4 6h16M4 12h10M4 18h7' },
];

// Fixed system entries in the unified Library list. `key` is the stable
// item_key sent to the server for pin/recency state — kept distinct from the
// route in spirit even though it currently matches the path, since routes can
// change but stored keys can't retroactively.
const LIBRARY_SYSTEM_ITEMS = [
  { key: 'all-songs', to: '/songs', label: 'All Songs', StockCover: AllSongsCover },
  { key: 'favorites', to: '/favorites', label: 'Favourites', StockCover: FavouritesCover },
  { key: 'recent', to: '/recent', label: 'Recently Played', StockCover: RecentlyPlayedCover },
  { key: 'most-played', to: '/most-played', label: 'Most Played', StockCover: MostPlayedCover },
  { key: 'downloaded', to: '/downloaded', label: 'Downloaded', StockCover: DownloadedCover },
  { key: 'discover', to: '/discover', label: 'Discover', StockCover: DiscoverCover },
  { key: 'wrapped', to: '/wrapped', label: 'Wrapped', StockCover: WrappedCover },
];

function libraryLinkClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800/50'
  }`;
}

export function Sidebar() {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const sidebarWidth = usePanelSizesStore((s) => s.sidebarWidth);
  const setSidebarWidth = usePanelSizesStore((s) => s.setSidebarWidth);
  const asideRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: adminGetSettings,
    enabled: user?.role === 'admin',
  });
  const donationVisible = settings?.donation_prompt_enabled !== 'false';

  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: getPlaylists });
  const { data: sidebarState = [] } = useQuery({
    queryKey: ['library-sidebar-state'],
    queryFn: getLibrarySidebarState,
  });

  const createPlaylist = async () => {
    const name = playlists.length > 0 ? `New Playlist ${playlists.length + 1}` : 'New Playlist';
    const pl = await createPlaylistWithName(name);
    qc.invalidateQueries({ queryKey: ['playlists'] });
    navigate(`/playlists/${pl.id}`);
  };

  const libraryRows: LibraryRow[] = [
    ...LIBRARY_SYSTEM_ITEMS.map((item): LibraryRow => ({
      itemType: 'system', itemKey: item.key, to: item.to, label: item.label, StockCover: item.StockCover,
    })),
    ...playlists.map((pl): LibraryRow => ({
      itemType: 'playlist', itemKey: pl.id, to: `/playlists/${pl.id}`, label: pl.name, coverArt: pl.coverArt,
    })),
  ];
  const { pinned, dynamic } = orderLibraryRows(libraryRows, sidebarState);

  return (
    <>
    <aside
      ref={asideRef}
      style={{ width: sidebarWidth }}
      className="flex-shrink-0 flex flex-col bg-zinc-950 border-r border-zinc-800 py-4 overflow-y-auto">
      {/* Logo */}
      <div className="px-5 pb-4 mb-2 border-b border-zinc-800">
        <span className="text-lg font-bold text-brand tracking-tight">RiffPlayer</span>
      </div>

      {/* Fixed top nav */}
      <nav className="px-2 space-y-0.5">
        {TOP_NAV.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} className={libraryLinkClass}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
            </svg>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Unified Library list */}
      <div className="px-2 mt-4">
        <div className="flex items-center justify-between px-3 mb-1">
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Library</span>
          <button
            onClick={createPlaylist}
            title="Create playlist"
            className="text-zinc-500 hover:text-zinc-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
        {pinned.length > 0 && (
          <nav className="space-y-1 pb-2 mb-2 border-b border-zinc-800/60">
            {pinned.map((row) => (
              <SidebarLibraryItem
                key={`${row.itemType}:${row.itemKey}`}
                to={row.to}
                label={row.label}
                coverArt={row.coverArt}
                StockCover={row.StockCover}
                itemType={row.itemType}
                itemKey={row.itemKey}
                pinned
              />
            ))}
          </nav>
        )}
        <nav className="space-y-1">
          {dynamic.map((row) => (
            <SidebarLibraryItem
              key={`${row.itemType}:${row.itemKey}`}
              to={row.to}
              label={row.label}
              coverArt={row.coverArt}
              StockCover={row.StockCover}
              itemType={row.itemType}
              itemKey={row.itemKey}
              pinned={false}
            />
          ))}
        </nav>
      </div>

      <div className="flex-1" />

      {/* Settings + donation */}
      <div className="px-2 mt-2 pt-2 border-t border-zinc-800 space-y-0.5">
        <NavLink to="/settings" className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800/50'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
          Settings
        </NavLink>

        {donationVisible && (
          <Link to="https://ko-fi.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-3 py-2 rounded-md text-xs text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/30 transition-colors">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" /></svg>
            Support RiffPlayer
          </Link>
        )}
      </div>

      {/* Logout */}
      <div className="px-2 mt-1">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800/50 w-full transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
    <ResizeHandle
      targetRef={asideRef} width={sidebarWidth} min={SIDEBAR_MIN} max={SIDEBAR_MAX}
      direction={1} onCommit={setSidebarWidth}
    />
    </>
  );
}
