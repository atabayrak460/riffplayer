import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/types.dart';
import '../../providers/providers.dart';
import '../song_tile.dart';
import '../../app_colors.dart';

/// Mirrors web's NowPlayingPanel AlbumTracksSection — other tracks from the
/// current song's album. Player screen equivalent of #68.
class AlbumTracksSection extends ConsumerWidget {
  final Song song;
  const AlbumTracksSection({super.key, required this.song});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final albumAsync = ref.watch(albumDetailProvider(song.albumId));

    return albumAsync.maybeWhen(
      data: (result) {
        final tracks = result.songs;
        final others = tracks.where((t) => t.id != song.id).toList();
        if (others.isEmpty) return const SizedBox.shrink();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
              child: Text(
                'MORE FROM THIS ALBUM',
                style: TextStyle(
                  color: AppColors.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.1,
                ),
              ),
            ),
            ...others.map((track) => SongTile(
                  song: track,
                  queue: tracks,
                  index: tracks.indexWhere((t) => t.id == track.id),
                  showNumber: true,
                )),
          ],
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }
}
