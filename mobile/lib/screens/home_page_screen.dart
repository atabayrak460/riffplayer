import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../widgets/cover_art.dart';
import '../widgets/home_album_card.dart';
import '../widgets/home_playlist_card.dart';
import '../widgets/home_row.dart';
import '../widgets/home_track_card.dart';
import '../widgets/stock_covers.dart' as stock;
import '../app_colors.dart';

/// The app's landing tab — a dashboard of listening-history-driven sections,
/// distinct from the full Albums library grid (still reachable via each
/// section's "See all" link, or Search).
class HomePageScreen extends ConsumerWidget {
  const HomePageScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(
          title: const Text('Home'),
          actions: [
            IconButton(
              icon: const Icon(Icons.explore_outlined),
              tooltip: 'Discover',
              onPressed: () => context.push('/discover'),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: const [
            _WrappedPreviewCard(),
            SizedBox(height: 28),
            _ContinueListeningSection(),
            SizedBox(height: 28),
            _MostPlayedSection(),
            SizedBox(height: 28),
            _RediscoverSection(),
            SizedBox(height: 80),
          ],
        ),
      );
}

class _WrappedPreviewCard extends StatelessWidget {
  const _WrappedPreviewCard();

  @override
  Widget build(BuildContext context) {
    final year = DateTime.now().year;
    return GestureDetector(
      onTap: () => context.push('/wrapped'),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: [
            stock.WrappedCover(
                size: 52, borderRadius: BorderRadius.circular(10)),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$year Wrapped',
                      style: TextStyle(
                          color: AppColors.text,
                          fontWeight: FontWeight.bold,
                          fontSize: 16)),
                  Text(
                    'Your year in music, so far.',
                    style: TextStyle(color: AppColors.muted, fontSize: 12.5),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

class _ContinueListeningSection extends ConsumerWidget {
  const _ContinueListeningSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lastPlayedAsync = ref.watch(lastPlayedProvider);
    final recentAlbumsAsync = ref.watch(albumListProvider('newest'));
    final lastPlayed = lastPlayedAsync.valueOrNull;
    final recentAlbums = recentAlbumsAsync.valueOrNull ?? [];

    if (lastPlayed == null && recentAlbums.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Continue Listening',
          style: TextStyle(
              color: AppColors.text, fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        if (lastPlayed != null) _ResumeCard(song: lastPlayed),
        if (lastPlayed != null && recentAlbums.isNotEmpty)
          const SizedBox(height: 20),
        if (recentAlbums.isNotEmpty)
          HomeRow(
            title: 'Recently added',
            viewAllTo: '/albums',
            children: recentAlbums
                .take(12)
                .map((a) => HomeAlbumCard(album: a))
                .toList(),
          ),
      ],
    );
  }
}

class _ResumeCard extends ConsumerWidget {
  final Song song;
  const _ResumeCard({required this.song});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final coverUrl = song.coverArt != null
        ? client?.coverArtUrl(song.coverArt!, size: 160)
        : null;

    return GestureDetector(
      onTap: () async {
        if (client == null) return;
        final downloads = ref.read(downloadServiceProvider);
        final result = await client.getAlbum(song.albumId);
        final idx = result.songs.indexWhere((s) => s.id == song.id);
        ref.read(playerProvider.notifier).playSong(
              song,
              client,
              downloads,
              queue: result.songs,
              queueIndex: idx == -1 ? 0 : idx,
            );
      },
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            CoverArt(
                url: coverUrl,
                size: 56,
                borderRadius: BorderRadius.circular(6)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'JUMP BACK IN',
                    style: TextStyle(
                      color: AppColors.muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    song.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: AppColors.text,
                        fontWeight: FontWeight.w600,
                        fontSize: 14),
                  ),
                  Text(
                    '${song.artist} · ${song.album}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: AppColors.muted, fontSize: 12),
                  ),
                ],
              ),
            ),
            Icon(Icons.play_circle_fill,
                color: Theme.of(context).colorScheme.primary, size: 36),
          ],
        ),
      ),
    );
  }
}

class _MostPlayedSection extends ConsumerWidget {
  const _MostPlayedSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final songsAsync = ref.watch(mostPlayedProvider);
    final playlistsAsync = ref.watch(playlistsProvider);
    final songs = songsAsync.valueOrNull ?? [];
    final playlists = playlistsAsync.valueOrNull ?? [];

    if (songs.isEmpty && playlists.isEmpty) return const SizedBox.shrink();
    final topSongs = songs.take(10).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Most Played',
          style: TextStyle(
              color: AppColors.text, fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 16),
        if (topSongs.isNotEmpty)
          HomeRow(
            title: 'Your most played',
            children: topSongs
                .map((s) => HomeTrackCard(song: s, queue: topSongs))
                .toList(),
          ),
        if (topSongs.isNotEmpty && playlists.isNotEmpty)
          const SizedBox(height: 20),
        if (playlists.isNotEmpty)
          HomeRow(
            title: 'Your playlists',
            viewAllTo: '/library',
            children:
                playlists.map((p) => HomePlaylistCard(playlist: p)).toList(),
          ),
      ],
    );
  }
}

class _RediscoverSection extends ConsumerWidget {
  const _RediscoverSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final songsAsync = ref.watch(rediscoverProvider);
    final songs = songsAsync.valueOrNull ?? [];
    if (songs.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Rediscover',
          style: TextStyle(
              color: AppColors.text, fontSize: 20, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 4),
        Text(
          'You might have forgotten these.',
          style: TextStyle(color: AppColors.muted, fontSize: 13),
        ),
        const SizedBox(height: 16),
        HomeRow(
          title: 'From your library',
          children:
              songs.map((s) => HomeTrackCard(song: s, queue: songs)).toList(),
        ),
      ],
    );
  }
}
