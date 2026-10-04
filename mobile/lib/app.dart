import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'providers/providers.dart';
import 'connect/connect_provider.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/home_page_screen.dart';
import 'screens/albums_screen.dart';
import 'screens/all_songs_screen.dart';
import 'screens/album_detail_screen.dart';
import 'screens/artists_screen.dart';
import 'screens/artist_detail_screen.dart';
import 'screens/search_screen.dart';
import 'screens/favorites_screen.dart';
import 'screens/downloads_screen.dart';
import 'screens/downloaded_playlist_detail_screen.dart';
import 'screens/library_screen.dart';
import 'screens/playlist_detail_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/player_screen.dart';
import 'screens/queue_screen.dart';
import 'screens/wrapped_screen.dart';
import 'screens/discover_screen.dart';
import 'screens/recently_played_screen.dart';
import 'screens/most_played_screen.dart';
import 'screens/admin_screen.dart';
import 'app_colors.dart';
import 'providers/theme_provider.dart';
import 'theme.dart';
import 'widgets/splash_overlay.dart';

// Notifies GoRouter to re-run `redirect` whenever auth state changes.
class _AuthRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}

class RiffPlayerApp extends ConsumerStatefulWidget {
  const RiffPlayerApp({super.key});

  @override
  ConsumerState<RiffPlayerApp> createState() => _RiffPlayerAppState();
}

class _RiffPlayerAppState extends ConsumerState<RiffPlayerApp>
    with WidgetsBindingObserver {
  final _authRefresh = _AuthRefreshNotifier();
  AppSkin _skin = AppSkin.standard;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _skin = ref.read(skinProvider);
    ref.listenManual(authProvider, (_, __) => _authRefresh.notify());

    // RiffPlayer Connect follows the session: connected while signed in, gone on sign-out.
    WidgetsBinding.instance.addObserver(this);
    ref.listenManual(authProvider, (_, next) {
      final creds = next.valueOrNull;
      final connect = ref.read(connectProvider.notifier);
      if (creds != null) {
        connect.start(creds);
      } else {
        connect.stop();
      }
    }, fireImmediately: true);

    _router = GoRouter(
      initialLocation: '/login',
      refreshListenable: _authRefresh,
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
        GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),

        // Full-screen player (outside the shell)
        // Non-opaque + slide-up: while the player is pulled down to close,
        // the screen underneath stays visible behind it.
        GoRoute(
          path: '/player',
          pageBuilder: (_, state) => CustomTransitionPage<void>(
            key: state.pageKey,
            opaque: false,
            transitionDuration: const Duration(milliseconds: 300),
            reverseTransitionDuration: const Duration(milliseconds: 250),
            child: const PlayerScreen(),
            transitionsBuilder: (_, animation, __, child) => SlideTransition(
              position:
                  Tween<Offset>(begin: const Offset(0, 1), end: Offset.zero)
                      .animate(CurvedAnimation(
                          parent: animation,
                          curve: Curves.easeOutCubic,
                          reverseCurve: Curves.easeInCubic)),
              child: child,
            ),
          ),
        ),
        GoRoute(path: '/queue', builder: (_, __) => const QueueScreen()),

        // Shell with bottom nav + mini player
        ShellRoute(
          builder: (_, __, child) => HomeScreen(child: child),
          routes: [
            GoRoute(path: '/home', builder: (_, __) => const HomePageScreen()),
            GoRoute(path: '/albums', builder: (_, __) => const AlbumsScreen()),
            GoRoute(path: '/songs', builder: (_, __) => const AllSongsScreen()),
            GoRoute(
              path: '/albums/:id',
              builder: (_, state) =>
                  AlbumDetailScreen(albumId: state.pathParameters['id']!),
            ),
            GoRoute(
                path: '/artists', builder: (_, __) => const ArtistsScreen()),
            GoRoute(
              path: '/artists/:id',
              builder: (_, state) => ArtistDetailScreen(
                artistId: state.pathParameters['id']!,
                initialSongsTab: state.uri.queryParameters['tab'] == 'songs',
              ),
            ),
            GoRoute(path: '/search', builder: (_, __) => const SearchScreen()),
            GoRoute(
                path: '/favorites',
                builder: (_, __) => const FavoritesScreen()),
            GoRoute(
                path: '/downloads',
                builder: (_, __) => const DownloadsScreen()),
            GoRoute(
              path: '/downloads/playlists/:id',
              builder: (_, state) => DownloadedPlaylistDetailScreen(
                  playlistId: state.pathParameters['id']!),
            ),
            GoRoute(
                path: '/library', builder: (_, __) => const LibraryScreen()),
            GoRoute(
              path: '/playlists/:id',
              builder: (_, state) =>
                  PlaylistDetailScreen(playlistId: state.pathParameters['id']!),
            ),
            GoRoute(
                path: '/settings', builder: (_, __) => const SettingsScreen()),
            GoRoute(
                path: '/wrapped', builder: (_, __) => const WrappedScreen()),
            GoRoute(
                path: '/discover', builder: (_, __) => const DiscoverScreen()),
            GoRoute(
                path: '/recent',
                builder: (_, __) => const RecentlyPlayedScreen()),
            GoRoute(
                path: '/most-played',
                builder: (_, __) => const MostPlayedScreen()),
            GoRoute(path: '/admin', builder: (_, __) => const AdminScreen()),
          ],
        ),
      ],
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    ref
        .read(connectProvider.notifier)
        .setForeground(lifecycle == AppLifecycleState.resumed);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _authRefresh.dispose();
    super.dispose();
  }

  // "System" mode follows the device: re-evaluate when it flips.
  @override
  void didChangePlatformBrightness() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final mode = ref.watch(themeModeProvider);
    final skin = ref.watch(skinProvider);
    final palette = resolvePalette(mode, skin,
        WidgetsBinding.instance.platformDispatcher.platformBrightness);
    if (!identical(palette, AppColors.current) || skin != _skin) {
      _skin = skin;
      AppColors.current = palette;
      applySystemChrome(palette);
      // Colours are read from AppColors, not an InheritedWidget — repaint
      // everything that was built with the old palette.
      WidgetsBinding.instance.addPostFrameCallback((_) => rebuildAll());
    }
    return MaterialApp.router(
      title: 'RiffPlayer',
      theme: buildTheme(AppColors.current, skin),
      routerConfig: _router,
      builder: (context, child) => SkinBackdrop(
        skin: skin,
        child: SplashOverlay(child: child ?? const SizedBox.shrink()),
      ),
      scaffoldMessengerKey: rootMessengerKey,
      debugShowCheckedModeBanner: false,
    );
  }
}
