import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';
import 'cover_art.dart';
import 'stock_covers.dart' as stock;
import '../app_colors.dart';

Widget _stockCoverFor(String key,
    {required double size, required BorderRadius borderRadius}) {
  switch (key) {
    case 'albums':
      return Container(
        width: size,
        height: size,
        decoration:
            BoxDecoration(color: AppColors.surface, borderRadius: borderRadius),
        child: Icon(Icons.album_outlined,
            color: AppColors.muted, size: size * 0.5),
      );
    case 'all-songs':
      return stock.AllSongsCover(size: size, borderRadius: borderRadius);
    case 'favorites':
      return stock.FavouritesCover(size: size, borderRadius: borderRadius);
    case 'recent':
      return stock.RecentlyPlayedCover(size: size, borderRadius: borderRadius);
    case 'most-played':
      return stock.MostPlayedCover(size: size, borderRadius: borderRadius);
    case 'downloaded':
      return stock.DownloadedCover(size: size, borderRadius: borderRadius);
    case 'discover':
      return stock.DiscoverCover(size: size, borderRadius: borderRadius);
    case 'wrapped':
      return stock.WrappedCover(size: size, borderRadius: borderRadius);
    default:
      return stock.PlaylistCover(size: size, borderRadius: borderRadius);
  }
}

/// A single flat row in the unified Library list — mirrors the visual
/// language of the web sidebar's `SidebarLibraryItem`: a small square cover
/// (real playlist art, or a fixed stock design for system views), a label,
/// and a pin glyph when pinned. Tap navigates; long-press offers pin/unpin.
class LibraryListRow extends ConsumerWidget {
  final String label;
  final String? coverArt;
  final String? stockCoverKey;
  final bool pinned;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  const LibraryListRow({
    super.key,
    required this.label,
    this.coverArt,
    this.stockCoverKey,
    required this.pinned,
    required this.onTap,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final radius = BorderRadius.circular(8);
    final fallback = _stockCoverFor(stockCoverKey ?? 'playlist',
        size: 44, borderRadius: radius);

    final client = ref.read(apiClientProvider);
    final url =
        coverArt != null ? client?.coverArtUrl(coverArt!, size: 100) : null;

    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Row(
          children: [
            CoverArt(
                url: url, size: 44, borderRadius: radius, fallback: fallback),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                    color: AppColors.text,
                    fontSize: 15,
                    fontWeight: FontWeight.w500),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (pinned)
              Padding(
                padding: const EdgeInsets.only(left: 8),
                child: Icon(Icons.push_pin, size: 14, color: AppColors.muted),
              ),
          ],
        ),
      ),
    );
  }
}
