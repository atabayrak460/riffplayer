import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import 'cover_art.dart';
import 'stock_covers.dart' as stock;
import '../app_colors.dart';

class HomePlaylistCard extends ConsumerWidget {
  final Playlist playlist;
  const HomePlaylistCard({super.key, required this.playlist});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final coverUrl = playlist.coverArt != null
        ? client?.coverArtUrl(playlist.coverArt!, size: 300)
        : null;

    return GestureDetector(
      onTap: () => context.push('/playlists/${playlist.id}'),
      child: SizedBox(
        width: 140,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: CoverArt(
                url: coverUrl,
                size: null,
                borderRadius: BorderRadius.circular(8),
                fallback: const stock.PlaylistCover(size: null),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              playlist.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: AppColors.text,
                  fontWeight: FontWeight.w500,
                  fontSize: 13),
            ),
            Text(
              '${playlist.songCount} tracks',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
