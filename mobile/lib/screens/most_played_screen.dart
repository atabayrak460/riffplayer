import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';
import '../widgets/song_tile.dart';
import '../widgets/stock_covers.dart' as stock;
import '../app_colors.dart';

class MostPlayedScreen extends ConsumerWidget {
  const MostPlayedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final songsAsync = ref.watch(mostPlayedProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Most Played'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(mostPlayedProvider),
          ),
        ],
      ),
      body: songsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text('Could not load history.',
              style: TextStyle(color: AppColors.muted)),
        ),
        data: (songs) {
          if (songs.isEmpty) {
            return Center(
              child: Text('Nothing played yet.',
                  style: TextStyle(color: AppColors.muted)),
            );
          }
          return ListView(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    stock.MostPlayedCover(
                        size: 56, borderRadius: BorderRadius.circular(10)),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text('Most Played',
                          style: TextStyle(
                              color: AppColors.text,
                              fontWeight: FontWeight.bold,
                              fontSize: 16)),
                    ),
                  ],
                ),
              ),
              ...songs.map((song) =>
                  SongTile(song: song, queue: songs, showAlbum: true)),
              const SizedBox(height: 24),
            ],
          );
        },
      ),
    );
  }
}
