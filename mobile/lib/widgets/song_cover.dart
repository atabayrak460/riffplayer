import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import 'cover_art.dart';

/// The locally saved cover of a downloaded song, or null when the song isn't
/// downloaded (or has no saved cover).
final localCoverPathProvider =
    FutureProvider.autoDispose.family<String?, String>((ref, songId) async {
  try {
    return await ref.read(downloadServiceProvider).localCoverPath(songId);
  } catch (_) {
    return null;
  }
});

/// A song's cover: the copy saved on the device when the song is downloaded
/// (so it also shows offline), otherwise the server's image at [remoteSize].
class SongCover extends ConsumerWidget {
  final Song song;
  final double size;

  /// Size requested from the server when there's no local copy.
  final int remoteSize;
  final BorderRadius? borderRadius;

  const SongCover({
    super.key,
    required this.song,
    required this.size,
    required this.remoteSize,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final remote = CoverArt(
      url: song.coverArt != null
          ? client?.coverArtUrl(song.coverArt!, size: remoteSize)
          : null,
      size: size,
      borderRadius: borderRadius,
    );
    final path = ref.watch(localCoverPathProvider(song.id)).valueOrNull;
    if (path == null) return remote;
    return ClipRRect(
      borderRadius: borderRadius ?? BorderRadius.circular(6),
      child: Image.file(
        File(path),
        width: size,
        height: size,
        fit: BoxFit.cover,
        // A file that can't be read falls back to the server's image.
        errorBuilder: (_, __, ___) => remote,
      ),
    );
  }
}
