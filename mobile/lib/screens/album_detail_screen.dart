import '../utils/quality.dart';
import '../widgets/quality_badge.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';
import '../widgets/song_tile.dart';
import '../app_colors.dart';

class AlbumDetailScreen extends ConsumerWidget {
  final String albumId;
  const AlbumDetailScreen({super.key, required this.albumId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albumAsync = ref.watch(albumDetailProvider(albumId));
    final client = ref.read(apiClientProvider);

    return albumAsync.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (e, _) => Scaffold(body: Center(child: Text('Error: $e'))),
      data: (data) {
        final album = data.album;
        final songs = data.songs;
        // Full-width banner (SliverAppBar background below), not a
        // thumbnail — needs a size closer to actual screen width.
        final coverUrl = album.coverArt != null
            ? client?.coverArtUrl(album.coverArt!, size: 800)
            : null;

        return Scaffold(
          body: CustomScrollView(
            slivers: [
              SliverAppBar(
                expandedHeight: 280,
                pinned: true,
                flexibleSpace: FlexibleSpaceBar(
                  background: coverUrl != null
                      ? Image.network(coverUrl, fit: BoxFit.cover)
                      : Container(color: AppColors.surface),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        album.name,
                        style: TextStyle(
                          color: AppColors.text,
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        album.artist,
                        style: TextStyle(
                          color: AppColors.brand,
                          fontSize: 15,
                        ),
                      ),
                      if (album.year != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          '${album.year} · ${songs.length} tracks',
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 13),
                        ),
                      ],
                      if (albumQuality(songs) != null) ...[
                        const SizedBox(height: 8),
                        QualityBadge(quality: albumQuality(songs)),
                      ],
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: () => _playAll(ref, songs),
                        icon: const Icon(Icons.play_arrow),
                        label: const Text('Play all'),
                      ),
                    ],
                  ),
                ),
              ),
              SliverList(
                delegate: SliverChildBuilderDelegate(
                  (_, i) => SongTile(
                    song: songs[i],
                    queue: songs,
                    index: i,
                    showNumber: true,
                  ),
                  childCount: songs.length,
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 100)),
            ],
          ),
        );
      },
    );
  }

  void _playAll(WidgetRef ref, List<dynamic> songs) {
    if (songs.isEmpty) return;
    final client = ref.read(apiClientProvider);
    final downloads = ref.read(downloadServiceProvider);
    if (client == null) return;
    ref.read(playerProvider.notifier).playSong(
          songs.first,
          client,
          downloads,
          queue: songs.cast(),
          queueIndex: 0,
        );
  }
}
