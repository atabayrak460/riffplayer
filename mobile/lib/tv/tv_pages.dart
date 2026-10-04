import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/types.dart';
import '../app_colors.dart';
import '../providers/providers.dart';
import 'tv_widgets.dart';

Widget _albumCard(BuildContext context, Album a, {bool autofocus = false}) =>
    TvCard(
      title: a.name,
      subtitle: a.artist,
      coverArt: a.coverArt,
      autofocus: autofocus,
      onActivate: () => context.push('/album/${a.id}'),
    );

Widget _playlistCard(BuildContext context, Playlist p) => TvCard(
      title: p.name,
      subtitle: '${p.songCount} ${p.songCount == 1 ? 'track' : 'tracks'}',
      coverArt: p.coverArt,
      onActivate: () => context.push('/playlist/${p.id}'),
    );

class TvHomePage extends ConsumerWidget {
  const TvHomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recent = ref.watch(albumListProvider('newest'));
    final frequent = ref.watch(albumListProvider('frequent'));
    final playlists = ref.watch(playlistsProvider);

    if (recent.isLoading && !recent.hasValue) {
      return const TvMessage('', loading: true);
    }

    return ListView(
      children: [
        TvRow(
          title: 'Recently added',
          children: [
            for (final a in recent.valueOrNull ?? const <Album>[])
              _albumCard(context, a),
          ],
        ),
        TvRow(
          title: 'Most played',
          children: [
            for (final a in frequent.valueOrNull ?? const <Album>[])
              _albumCard(context, a),
          ],
        ),
        TvRow(
          title: 'Playlists',
          children: [
            for (final p in playlists.valueOrNull ?? const <Playlist>[])
              _playlistCard(context, p),
          ],
        ),
        if (recent.hasError)
          const Padding(
              padding: EdgeInsets.all(32),
              child: TvMessage('Couldn\'t reach the server.')),
        const SizedBox(height: 32),
      ],
    );
  }
}

class TvAlbumsPage extends ConsumerWidget {
  const TvAlbumsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albums = ref.watch(albumListProvider('alphabeticalByName'));
    return albums.when(
      loading: () => const TvMessage('', loading: true),
      error: (_, __) => const TvMessage('Couldn\'t load your albums.'),
      data: (list) => list.isEmpty
          ? const TvMessage('No albums yet.')
          : TvGrid(children: [
              for (final (i, a) in list.indexed)
                _albumCard(context, a, autofocus: i == 0),
            ]),
    );
  }
}

class TvArtistsPage extends ConsumerWidget {
  const TvArtistsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final artists = ref.watch(artistsProvider);
    return artists.when(
      loading: () => const TvMessage('', loading: true),
      error: (_, __) => const TvMessage('Couldn\'t load your artists.'),
      data: (groups) {
        final all = [for (final g in groups) ...g.artists];
        return all.isEmpty
            ? const TvMessage('No artists yet.')
            : TvGrid(children: [
                for (final (i, a) in all.indexed)
                  TvCard(
                    title: a.name,
                    subtitle:
                        '${a.albumCount} ${a.albumCount == 1 ? 'album' : 'albums'}',
                    coverArt: a.coverArt,
                    round: true,
                    autofocus: i == 0,
                    onActivate: () => context.push('/artist/${a.id}'),
                  ),
              ]);
      },
    );
  }
}

class TvPlaylistsPage extends ConsumerWidget {
  const TvPlaylistsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlists = ref.watch(playlistsProvider);
    return playlists.when(
      loading: () => const TvMessage('', loading: true),
      error: (_, __) => const TvMessage('Couldn\'t load your playlists.'),
      data: (list) => list.isEmpty
          ? const TvMessage('No playlists yet.')
          : TvGrid(children: [for (final p in list) _playlistCard(context, p)]),
    );
  }
}

class TvSettingsPage extends ConsumerWidget {
  const TvSettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final creds = ref.watch(authProvider).valueOrNull;
    return Padding(
      padding: const EdgeInsets.all(48),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Signed in',
              style: TextStyle(
                  color: AppColors.text,
                  fontSize: 32,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          Text('${creds?.username ?? ''} on ${creds?.serverUrl ?? ''}',
              style: TextStyle(color: AppColors.muted, fontSize: 22)),
          const SizedBox(height: 32),
          SizedBox(
            width: 280,
            child: TvFocusable(
              autofocus: true,
              onActivate: () => ref.read(authProvider.notifier).logout(),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text('Sign out of this TV',
                    style: TextStyle(color: AppColors.text, fontSize: 22)),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
              'You can also unlink this TV from the web app: Settings → Link a TV.',
              style: TextStyle(color: AppColors.muted, fontSize: 18)),
        ],
      ),
    );
  }
}
