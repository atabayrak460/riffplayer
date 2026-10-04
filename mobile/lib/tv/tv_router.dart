import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/providers.dart';
import 'tv_detail.dart';
import 'tv_login_screen.dart';
import 'tv_now_playing.dart';
import 'tv_pages.dart';
import 'tv_shell.dart';

/// The Android TV's screens. Same sign-in rule as the phone app, different screens: a rail + pages
/// that are driven by the remote, and a code-based login (see TvLoginScreen).
GoRouter buildTvRouter(WidgetRef ref, Listenable refresh) {
  return GoRouter(
    initialLocation: '/login',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      if (auth.isLoading) return null; // wait for the stored session to load
      final loggedIn = auth.valueOrNull != null;
      final atLogin = state.matchedLocation == '/login';
      if (!loggedIn && !atLogin) return '/login';
      if (loggedIn && atLogin) return '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const TvLoginScreen()),
      GoRoute(
          path: '/now-playing', builder: (_, __) => const TvNowPlayingScreen()),
      GoRoute(
        path: '/album/:id',
        builder: (_, s) => TvAlbumScreen(albumId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/playlist/:id',
        builder: (_, s) =>
            TvPlaylistScreen(playlistId: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/artist/:id',
        builder: (_, s) => TvArtistScreen(artistId: s.pathParameters['id']!),
      ),
      ShellRoute(
        builder: (_, __, child) => TvShell(child: child),
        routes: [
          GoRoute(path: '/home', builder: (_, __) => const TvHomePage()),
          GoRoute(path: '/albums', builder: (_, __) => const TvAlbumsPage()),
          GoRoute(path: '/artists', builder: (_, __) => const TvArtistsPage()),
          GoRoute(
              path: '/playlists', builder: (_, __) => const TvPlaylistsPage()),
          GoRoute(
              path: '/settings', builder: (_, __) => const TvSettingsPage()),
        ],
      ),
    ],
  );
}
