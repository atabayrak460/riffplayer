import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:path/path.dart' as p;
import '../api/types.dart';
import '../providers/providers.dart';
import '../utils/snackbar.dart';
import 'add_to_playlist_dialog.dart';
import '../app_colors.dart';

String fmtDownloadSize(int? bytes) {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

/// Reconstructs a [Song] from a [DownloadedTrack] so it can be handed to
/// [PlayerNotifier.playSong] — every offline-first screen (Downloads, a
/// downloaded playlist's detail view) has no live server data to draw on,
/// so artist/album ids (only needed for "go to artist/album" navigation,
/// which this widget doesn't offer) are left blank rather than guessed.
/// `suffix` comes from the actual downloaded file's extension instead of
/// defaulting to mp3.
Song songFromDownloadedTrack(DownloadedTrack t) {
  final ext = p.extension(t.localPath);
  return Song(
    id: t.trackId,
    title: t.title,
    artist: t.artist,
    artistId: '',
    album: t.album,
    albumId: '',
    coverArt: t.coverArtId,
    suffix: ext.isNotEmpty ? ext.substring(1) : 'mp3',
    size: t.fileSize,
  );
}

/// A downloaded track's row — used by both the Downloads screen's flat list
/// and a downloaded playlist's detail view. Swipe right to queue (same
/// gesture as [SongTile]); an overflow menu for queue/add-to-playlist/
/// remove-download, since this predates [SongTile] and isn't reused
/// directly — a downloaded track has no live artist/album ids for
/// SongTile's "go to artist/album" menu items, and "remove download" isn't
/// a concept SongTile has at all.
class DownloadTile extends ConsumerWidget {
  final DownloadedTrack track;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const DownloadTile({
    super.key,
    required this.track,
    required this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Scoped to just the current song's id, same as SongTile — avoids every
    // row rebuilding on every playback position tick.
    final isCurrent = ref.watch(
        playerProvider.select((s) => s.currentSong?.id == track.trackId));

    final tile = ListTile(
      onTap: onTap,
      leading: _DownloadCover(track: track),
      title: Text(
        track.title,
        style: TextStyle(
          color: isCurrent
              ? Theme.of(context).colorScheme.primary
              : AppColors.text,
          fontWeight: isCurrent ? FontWeight.w600 : FontWeight.normal,
          fontSize: 14,
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        '${track.artist} · ${fmtDownloadSize(track.fileSize)}',
        style: TextStyle(color: AppColors.muted, fontSize: 12),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isCurrent) ...[
            Icon(Icons.graphic_eq,
                color: Theme.of(context).colorScheme.primary, size: 16),
            const SizedBox(width: 8),
          ],
          PopupMenuButton<String>(
            icon: Icon(Icons.more_vert, color: AppColors.muted, size: 18),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'queue', child: Text('Add to queue')),
              PopupMenuItem(value: 'playlist', child: Text('Add to playlist')),
              PopupMenuItem(value: 'remove', child: Text('Remove download')),
            ],
            onSelected: (v) => _onMenu(v, context, ref),
          ),
        ],
      ),
    );

    return Slidable(
      key: ValueKey('download-slidable-${track.trackId}'),
      // Swipe right → add to queue, same gesture/threshold as SongTile.
      // Disabled on the currently-playing row — queueing the song that's
      // already playing doesn't make sense.
      startActionPane: isCurrent
          ? null
          : ActionPane(
              motion: const StretchMotion(),
              extentRatio: 0.28,
              dismissible: DismissiblePane(
                dismissThreshold: 0.3,
                closeOnCancel: true,
                confirmDismiss: () async {
                  _addToQueue(context, ref);
                  return false;
                },
                onDismissed: () {},
              ),
              children: [
                SlidableAction(
                  onPressed: (_) => _addToQueue(context, ref),
                  backgroundColor: Theme.of(context).colorScheme.primary,
                  foregroundColor: AppColors.onBrand,
                  icon: Icons.queue_music,
                  label: 'Queue',
                ),
              ],
            ),
      child: tile,
    );
  }

  void _addToQueue(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final downloads = ref.read(downloadServiceProvider);
    ref
        .read(playerProvider.notifier)
        .addToQueue(songFromDownloadedTrack(track), client, downloads)
        .then((_) {
      // ignore: use_build_context_synchronously
      showSnackBar(context, 'Added to queue');
    }).catchError((_) {
      // ignore: use_build_context_synchronously
      showFailureSnackBar(context, 'Failed to add to queue');
    }).ignore();
  }

  Future<void> _confirmAndDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete download?'),
        content: Text('Remove "${track.title}" from device?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text('Delete', style: TextStyle(color: AppColors.danger))),
        ],
      ),
    );
    if (confirmed == true) onDelete();
  }

  void _onMenu(String action, BuildContext context, WidgetRef ref) {
    switch (action) {
      case 'queue':
        _addToQueue(context, ref);
      case 'playlist':
        showDialog(
          context: context,
          builder: (_) => AddToPlaylistDialog(songId: track.trackId),
        );
      case 'remove':
        _confirmAndDelete(context);
    }
  }
}

/// The downloaded track's locally-cached cover art, if it has one — falls
/// back to a generic note icon rather than a network fetch, since this
/// widget is specifically for offline-availability views.
class _DownloadCover extends StatelessWidget {
  final DownloadedTrack track;
  const _DownloadCover({required this.track});

  @override
  Widget build(BuildContext context) {
    final path = track.coverLocalPath;
    if (path == null || !File(path).existsSync()) {
      return Icon(Icons.music_note, color: AppColors.muted);
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: Image.file(File(path), width: 44, height: 44, fit: BoxFit.cover),
    );
  }
}
