import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import 'cover_art.dart';
import '../app_colors.dart';

class HomeAlbumCard extends ConsumerWidget {
  final Album album;
  const HomeAlbumCard({super.key, required this.album});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final coverUrl = album.coverArt != null
        ? client?.coverArtUrl(album.coverArt!, size: 300)
        : null;

    return GestureDetector(
      onTap: () => context.push('/albums/${album.id}'),
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
              ),
            ),
            const SizedBox(height: 8),
            Text(
              album.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: AppColors.text,
                  fontWeight: FontWeight.w500,
                  fontSize: 13),
            ),
            Text(
              album.artist,
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
