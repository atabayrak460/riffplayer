import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../api/subsonic.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../utils/snackbar.dart';
import 'add_to_playlist_dialog.dart';
import 'cover_art.dart';
import 'song_info_dialog.dart';
import '../app_colors.dart';

String _fmtDuration(int? seconds) {
  if (seconds == null) return '';
  final m = seconds ~/ 60;
  final s = seconds % 60;
  return '$m:${s.toString().padLeft(2, '0')}';
}

final _addedAtFormat = DateFormat.yMMMd();

class SongTile extends ConsumerWidget {
  final Song song;
  final List<Song>? queue;
  final int? index;
  final bool showAlbum;
  final bool showNumber;

  /// Shown as a right-aligned "date added" column when set — pass the
  /// track's own [Song.created] (library index date) in library-wide views
  /// like All Songs, or a playlist's per-track added-at date inside a
  /// playlist view.
  final DateTime? addedAt;

  /// Overrides the default "play this song, replacing the queue with
  /// [queue]" tap behavior — used by the Queue screen to jump to a song
  /// within the existing queue instead of replacing it.
  final VoidCallback? onTap;

  /// When set, adds a "Remove from queue" action to the overflow menu.
  final VoidCallback? onRemove;

  const SongTile({
    super.key,
    required this.song,
    this.queue,
    this.index,
    this.showAlbum = false,
    this.showNumber = false,
    this.addedAt,
    this.onTap,
    this.onRemove,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Scoped to just the current song's id (via .select()) rather than
    // watching the whole PlayerState — otherwise every visible SongTile in
    // a list rebuilds on every position tick during playback (several
    // times a second), not just the one that's actually playing.
    final currentSongId =
        ref.watch(playerProvider.select((s) => s.currentSong?.id));
    final isCurrent = currentSongId == song.id;
    final isAdmin = ref.watch(meProvider).valueOrNull?.isAdmin ?? false;

    final tile = ListTile(
      onTap: onTap ?? () => _play(ref),
      leading: showAlbum
          ? CoverArt(
              url: _coverUrl(ref, song.coverArt),
              size: 44,
            )
          : showNumber
              ? SizedBox(
                  width: 32,
                  child: Text(
                    (index != null) ? '${index! + 1}' : '',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: isCurrent
                          ? Theme.of(context).colorScheme.primary
                          : AppColors.muted,
                      fontSize: 14,
                    ),
                  ),
                )
              : null,
      title: Text(
        song.title,
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
        showAlbum ? '${song.artist} · ${song.album}' : song.artist,
        style: TextStyle(color: AppColors.muted, fontSize: 12),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (addedAt != null) ...[
            Text(
              _addedAtFormat.format(addedAt!),
              style: TextStyle(color: AppColors.muted, fontSize: 12),
            ),
            const SizedBox(width: 12),
          ],
          // Currently-playing rows can't be swiped to queue (see startActionPane
          // below) — this icon is the only surviving indicator of that once the
          // row layout is otherwise identical to any other row.
          if (isCurrent) ...[
            Icon(Icons.graphic_eq,
                color: Theme.of(context).colorScheme.primary, size: 16),
            const SizedBox(width: 4),
          ],
          Text(
            _fmtDuration(song.duration),
            style: TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          const SizedBox(width: 4),
          PopupMenuButton<String>(
            icon: Icon(Icons.more_vert, color: AppColors.muted, size: 18),
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'queue', child: Text('Add to queue')),
              const PopupMenuItem(
                  value: 'playlist', child: Text('Add to playlist')),
              const PopupMenuItem(value: 'download', child: Text('Download')),
              PopupMenuItem(
                value: 'star',
                child: Text(song.isStarred ? 'Unstar' : 'Star'),
              ),
              const PopupMenuItem(value: 'album', child: Text('Go to album')),
              const PopupMenuItem(value: 'artist', child: Text('Go to artist')),
              const PopupMenuItem(value: 'info', child: Text('Song info')),
              if (onRemove != null)
                const PopupMenuItem(
                    value: 'remove', child: Text('Remove from queue')),
              if (isAdmin)
                PopupMenuItem(
                  value: 'delete',
                  child: Text('Delete song',
                      style: TextStyle(color: AppColors.danger)),
                ),
            ],
            onSelected: (v) => _onMenu(v, context, ref),
          ),
        ],
      ),
    );

    return Slidable(
      key: ValueKey('slidable-${song.id}-${index ?? identityHashCode(song)}'),
      // Swipe right → add to queue. Disabled on the currently-playing row —
      // queueing the song that's already playing doesn't make sense.
      startActionPane: isCurrent
          ? null
          : ActionPane(
              motion: const StretchMotion(),
              extentRatio: 0.28,
              dismissible: DismissiblePane(
                // Low threshold — any real swipe-and-release fires this
                // immediately, not just a drag all the way through. Never
                // actually dismiss the row itself, though: this just lets the
                // full swipe act as an instant trigger (Spotify-style)
                // instead of requiring a follow-up tap on the action button.
                // closeOnCancel defaults to false, which would otherwise
                // leave the row sitting open (action button still showing)
                // after confirmDismiss cancels the dismissal below.
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
      // Swipe left → remove from queue — only wired up on the Queue screen,
      // where onRemove is passed.
      endActionPane: onRemove == null
          ? null
          : ActionPane(
              motion: const StretchMotion(),
              extentRatio: 0.28,
              dismissible: DismissiblePane(
                dismissThreshold: 0.3,
                onDismissed: () => onRemove!(),
              ),
              children: [
                SlidableAction(
                  onPressed: (_) => onRemove!(),
                  backgroundColor: Theme.of(context).colorScheme.error,
                  foregroundColor: Colors.white,
                  icon: Icons.remove_circle_outline,
                  label: 'Remove',
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
        .addToQueue(song, client, downloads)
        .then((_) {
      // ignore: use_build_context_synchronously
      showSnackBar(context, 'Added to queue');
    }).catchError((_) {
      // ignore: use_build_context_synchronously
      showFailureSnackBar(context, 'Failed to add to queue');
    }).ignore();
  }

  String? _coverUrl(WidgetRef ref, String? coverArt) {
    final client = ref.read(apiClientProvider);
    return coverArt != null ? client?.coverArtUrl(coverArt, size: 100) : null;
  }

  void _play(WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final downloads = ref.read(downloadServiceProvider);
    if (client == null) return;
    ref.read(playerProvider.notifier).playSong(
          song,
          client,
          downloads,
          queue: queue,
          queueIndex: queue?.indexOf(song),
        );
  }

  void _onMenu(String action, BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    switch (action) {
      case 'queue':
        _addToQueue(context, ref);
      case 'playlist':
        showDialog(
            context: context,
            builder: (_) => AddToPlaylistDialog(songId: song.id));
      case 'download':
        final downloads = ref.read(downloadServiceProvider);
        downloads.download(song, client).catchError((_) {
          // showFailureSnackBar itself guards on context.mounted — the
          // analyzer just can't see that check through the callee.
          // ignore: use_build_context_synchronously
          showFailureSnackBar(context, 'Download failed');
        }).ignore();
      case 'star':
        final newStarred = song.isStarred ? null : 'true';
        final future = song.isStarred
            ? client.unstar(id: song.id)
            : client.star(id: song.id);
        future.then((_) {
          ref
              .read(playerProvider.notifier)
              .setStarredInQueue(song.id, newStarred);
          ref.invalidate(starredProvider);
        }).catchError((_) {
          showFailureSnackBar(
              // ignore: use_build_context_synchronously
              context,
              song.isStarred ? 'Failed to unstar' : 'Failed to star');
        }).ignore();
      case 'album':
        // `.go()`, not `.push()`: this menu is reachable from a track's own
        // album/artist page (e.g. an album's own track list), where pushing
        // a duplicate of the page already underneath crashes with a
        // duplicate-GlobalKey assertion.
        context.go('/albums/${song.albumId}');
      case 'artist':
        context.go('/artists/${song.artistId}');
      case 'info':
        showDialog(
            context: context, builder: (_) => SongInfoDialog(song: song));
      case 'remove':
        onRemove?.call();
      case 'delete':
        _confirmDelete(context, client);
    }
  }

  Future<void> _confirmDelete(
      BuildContext context, SubsonicClient client) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete song?'),
        content: Text(
            'Permanently delete "${song.title}"? This deletes the file and cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('Delete', style: TextStyle(color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await client.deleteTrack(song.id);
      // ignore: use_build_context_synchronously
      showSnackBar(context, 'Deleted "${song.title}"');
    } catch (_) {
      // ignore: use_build_context_synchronously
      showFailureSnackBar(context, 'Failed to delete song');
    }
  }
}
