import { SplashScreen } from './components/SplashScreen';
import { lazy } from 'react';
import { Navigate, createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './store/auth';
import { Layout } from './components/Layout';
import { RouteErrorPage } from './components/RouteErrorPage';
import { LoginPage } from './pages/LoginPage';
import { AlbumsPage } from './pages/AlbumsPage';

// Lazy-loaded: everything reachable only after navigating past the initial
// login/albums landing. Admin pages in particular are only reachable by
// admins but would otherwise ship in every user's initial bundle.
const PeoplePage = lazy(() => import('./pages/PeoplePage').then((m) => ({ default: m.PeoplePage })));
const PersonPage = lazy(() => import('./pages/PersonPage').then((m) => ({ default: m.PersonPage })));
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const AlbumDetailPage = lazy(() => import('./pages/AlbumDetailPage').then((m) => ({ default: m.AlbumDetailPage })));
const ArtistsPage = lazy(() => import('./pages/ArtistsPage').then((m) => ({ default: m.ArtistsPage })));
const ArtistDetailPage = lazy(() => import('./pages/ArtistDetailPage').then((m) => ({ default: m.ArtistDetailPage })));
const AllSongsPage = lazy(() => import('./pages/AllSongsPage').then((m) => ({ default: m.AllSongsPage })));
const QueuePage = lazy(() => import('./pages/QueuePage').then((m) => ({ default: m.QueuePage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage').then((m) => ({ default: m.FavoritesPage })));
const RecentlyPlayedPage = lazy(() => import('./pages/RecentlyPlayedPage').then((m) => ({ default: m.RecentlyPlayedPage })));
const MostPlayedPage = lazy(() => import('./pages/MostPlayedPage').then((m) => ({ default: m.MostPlayedPage })));
const PlaylistsPage = lazy(() => import('./pages/PlaylistsPage').then((m) => ({ default: m.PlaylistsPage })));
const PlaylistDetailPage = lazy(() => import('./pages/PlaylistDetailPage').then((m) => ({ default: m.PlaylistDetailPage })));
const DownloadedPage = lazy(() => import('./pages/DownloadedPage').then((m) => ({ default: m.DownloadedPage })));
const OfflinePlaylistPage = lazy(() => import('./pages/OfflinePlaylistPage').then((m) => ({ default: m.OfflinePlaylistPage })));
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const UsersPage = lazy(() => import('./pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const LibrariesPage = lazy(() => import('./pages/admin/LibrariesPage').then((m) => ({ default: m.LibrariesPage })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const UserSettingsPage = lazy(() => import('./pages/UserSettingsPage').then((m) => ({ default: m.UserSettingsPage })));
const AccountSettingsPanel = lazy(() => import('./pages/UserSettingsPage').then((m) => ({ default: m.AccountSettingsPanel })));
const RecommendationsPage = lazy(() => import('./pages/RecommendationsPage').then((m) => ({ default: m.RecommendationsPage })));
const WrappedPage = lazy(() => import('./pages/WrappedPage').then((m) => ({ default: m.WrappedPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

function ProtectedRoute() {
  const credentials = useAuthStore((s) => s.credentials);
  if (!credentials) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Navigate to="/albums" replace /> },
          { path: 'home', element: <HomePage /> },
          { path: 'albums', element: <AlbumsPage /> },
          { path: 'albums/:id', element: <AlbumDetailPage /> },
          { path: 'artists', element: <ArtistsPage /> },
          { path: 'artists/:id', element: <ArtistDetailPage /> },
          { path: 'songs', element: <AllSongsPage /> },
          { path: 'queue', element: <QueuePage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'favorites', element: <FavoritesPage /> },
          { path: 'recent', element: <RecentlyPlayedPage /> },
          { path: 'most-played', element: <MostPlayedPage /> },
          { path: 'playlists', element: <PlaylistsPage /> },
          { path: 'playlists/:id', element: <PlaylistDetailPage /> },
          { path: 'downloaded', element: <DownloadedPage /> },
          { path: 'downloaded/playlists/:id', element: <OfflinePlaylistPage /> },
          { path: 'discover', element: <RecommendationsPage /> },
          { path: 'wrapped', element: <WrappedPage /> },
          { path: 'people', element: <PeoplePage /> },
          { path: 'people/:id', element: <PersonPage /> },
          {
            path: 'settings',
            element: <UserSettingsPage />,
            children: [
              { index: true, element: <AccountSettingsPanel /> },
              {
                path: 'admin',
                element: <AdminPage />,
                children: [
                  { index: true, element: <Navigate to="/settings/admin/users" replace /> },
                  { path: 'users', element: <UsersPage /> },
                  { path: 'libraries', element: <LibrariesPage /> },
                  { path: 'settings', element: <SettingsPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <SplashScreen />
    </QueryClientProvider>
  );
}
