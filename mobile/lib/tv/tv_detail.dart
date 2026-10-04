import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../api/types.dart';
import '../app_colors.dart';
import '../providers/providers.dart';
import '../providers/radio_provider.dart';
import 'tv_widgets.dart';

/// An album or a playlist: the cover and a Play button on the left, the tracks beside them.
class _TrackListScreen extends ConsumerWidget {
  const _TrackListScreen({
    required this.title,
    required this.subtitle,
    required this.coverArt,
    required this.songs,
    this.radioSeed,
  });

  final String title;
  final String subtitle;
  final String? coverArt;
  final List<Song> songs;
  final RadioSeed? radioSeed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final cover =
        coverArt != null ? client?.coverArtUrl(coverArt!, size: 600) : null;

    Widget button(String label, IconData icon, VoidCallback onTap,
            {bool autofocus = false}) =>
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TvFocusable(
            autofocus: autofocus,
            onActivate: onTap,
            child: Container(
              width: 300,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              decoration: BoxDecoration(
                color: autofocus ? AppColors.brand : AppColors.surface2,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(children: [
                Icon(icon,
                    color: autofocus ? AppColors.onBrand : AppColors.text),
                const SizedBox(width: 12),
                Text(label,
                    style: TextStyle(
                        color: autofocus ? AppColors.onBrand : AppColors.text,
                        fontSize: 22,
                        fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
        );

    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(40),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 320,
              child: FocusTraversalGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: SizedBox(
                        width: 300,
                        height: 300,
                        child: cover == null
                            ? Container(color: AppColors.surface)
                            : Image.network(cover, fit: BoxFit.cover),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: AppColors.text,
                            fontSize: 28,
                            fontWeight: FontWeight.bold)),
                    Text(subtitle,
                        style: TextStyle(color: AppColors.muted, fontSize: 20)),
                    const SizedBox(height: 20),
                    button('Play', Icons.play_arrow, () => tvPlay(ref, songs),
                        autofocus: true),
                    if (radioSeed != null)
                      button('Radio', Icons.radio, () async {
                        await ref
                            .read(radioProvider.notifier)
                            .start(radioSeed!);
                      }),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 32),
            Expanded(
              child: FocusTraversalGroup(
                child: songs.isEmpty
                    ? const TvMessage('No tracks.')
                    : ListView.builder(
                        itemCount: songs.length,
                        itemBuilder: (_, i) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: TvFocusable(
                            borderRadius: 8,
                            onActivate: () => tvPlay(ref, songs, i),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 12),
                              child: Row(
                                children: [
                                  SizedBox(
                                    width: 44,
                                    child: Text('${i + 1}',
                                        style: TextStyle(
                                            color: AppColors.muted,
                                            fontSize: 20)),
                                  ),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(songs[i].title,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                                color: AppColors.text,
                                                fontSize: 22)),
                                        Text(songs[i].artist,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                                color: AppColors.muted,
                                                fontSize: 16)),
                                      ],
                                    ),
                                  ),
                                  if (songs[i].duration != null)
                                    Text(
                                        tvFormatDuration(Duration(
                                            seconds: songs[i].duration!)),
                                        style: TextStyle(
                                            color: AppColors.muted,
                                            fontSize: 18)),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class TvAlbumScreen extends ConsumerWidget {
  const TvAlbumScreen({super.key, required this.albumId});
  final String albumId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final album = ref.watch(albumDetailProvider(albumId));
    return album.when(
      loading: () => const Scaffold(body: TvMessage('', loading: true)),
      error: (_, __) =>
          const Scaffold(body: TvMessage('Couldn\'t load this album.')),
      data: (d) => _TrackListScreen(
        title: d.album.name,
        subtitle:
            '${d.album.artist}${d.album.year != null ? ' · ${d.album.year}' : ''}',
        coverArt: d.album.coverArt,
        songs: d.songs,
        radioSeed: RadioSeed('album', d.album.id, d.album.name),
      ),
    );
  }
}

class TvPlaylistScreen extends ConsumerWidget {
  const TvPlaylistScreen({super.key, required this.playlistId});
  final String playlistId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlist = ref.watch(playlistDetailProvider(playlistId));
    return playlist.when(
      loading: () => const Scaffold(body: TvMessage('', loading: true)),
      error: (_, __) =>
          const Scaffold(body: TvMessage('Couldn\'t load this playlist.')),
      data: (p) => _TrackListScreen(
        title: p.name,
        subtitle: '${p.owner} · ${p.songCount} tracks',
        coverArt: p.coverArt,
        songs: p.entries ?? const [],
        radioSeed: RadioSeed('playlist', p.id, p.name),
      ),
    );
  }
}

class TvArtistScreen extends ConsumerWidget {
  const TvArtistScreen({super.key, required this.artistId});
  final String artistId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final artist = ref.watch(artistDetailProvider(artistId));
    return Scaffold(
      body: artist.when(
        loading: () => const TvMessage('', loading: true),
        error: (_, __) => const TvMessage('Couldn\'t load this artist.'),
        data: (d) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(40, 32, 40, 0),
              child: Text(d.artist.name,
                  style: TextStyle(
                      color: AppColors.text,
                      fontSize: 36,
                      fontWeight: FontWeight.bold)),
            ),
            Expanded(
              child: TvGrid(children: [
                for (final (i, a) in d.albums.indexed)
                  TvCard(
                    title: a.name,
                    subtitle: a.year?.toString(),
                    coverArt: a.coverArt,
                    autofocus: i == 0,
                    onActivate: () => context.push('/album/${a.id}'),
                  ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}
