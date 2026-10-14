import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/subsonic.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../providers/radio_provider.dart';
import '../utils/radio_actions.dart';
import '../utils/share_actions.dart';
import '../utils/snackbar.dart';
import '../app_colors.dart';
import 'add_to_playlist_dialog.dart';
import 'song_info_dialog.dart';

/// The per-song overflow actions, shared by [SongTile]'s `⋮` menu and the
/// full-screen player's menu so both offer the same things.
///
/// [canRemove] adds a remove entry, "Remove from queue" by default (the Queue
/// screen) or [removeLabel] (a playlist's track list);
/// [isAdmin] adds the destructive "Delete song".
List<PopupMenuEntry<String>> songMenuEntries(
  Song song, {
  required bool isAdmin,
  bool canRemove = false,
  String removeLabel = 'Remove from queue',
}) =>
    [
      const PopupMenuItem(value: 'queue', child: Text('Add to queue')),
      const PopupMenuItem(value: 'playlist', child: Text('Add to playlist')),
      const PopupMenuItem(value: 'download', child: Text('Download')),
      PopupMenuItem(
        value: 'star',
        child: Text(song.isStarred ? 'Unstar' : 'Star'),
      ),
      const PopupMenuItem(value: 'album', child: Text('Go to album')),
      const PopupMenuItem(value: 'artist', child: Text('Go to artist')),
      const PopupMenuItem(value: 'radio', child: Text('Start radio')),
      const PopupMenuItem(value: 'share', child: Text('Share as picture')),
      const PopupMenuItem(value: 'info', child: Text('Song info')),
      if (canRemove) PopupMenuItem(value: 'remove', child: Text(removeLabel)),
      if (isAdmin)
        PopupMenuItem(
          value: 'delete',
          child: Text('Delete song', style: TextStyle(color: AppColors.danger)),
        ),
    ];

void addSongToQueue(BuildContext context, WidgetRef ref, Song song) {
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

/// Runs the action picked from [songMenuEntries] on [song].
void handleSongAction(
  String action,
  BuildContext context,
  WidgetRef ref,
  Song song, {
  VoidCallback? onRemove,
}) {
  final client = ref.read(apiClientProvider);
  if (client == null) return;
  switch (action) {
    case 'radio':
      startRadio(context, ref, RadioSeed('song', song.id, song.title),
          firstSong: song);
    case 'share':
      shareSongAsPicture(context, ref, song);
    case 'queue':
      addSongToQueue(context, ref, song);
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
      showDialog(context: context, builder: (_) => SongInfoDialog(song: song));
    case 'remove':
      onRemove?.call();
    case 'delete':
      _confirmDelete(context, client, song);
  }
}

Future<void> _confirmDelete(
    BuildContext context, SubsonicClient client, Song song) async {
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
