import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';
import '../app_colors.dart';
import 'playlist_name_dialog.dart';

SnackBar _snack(String message) =>
    SnackBar(content: Text(message), duration: const Duration(seconds: 2));

class AddToPlaylistDialog extends ConsumerWidget {
  final String songId;
  const AddToPlaylistDialog({super.key, required this.songId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlistsAsync = ref.watch(playlistsProvider);

    // Previously this dialog could only add to an *existing* playlist — with
    // none created yet it was a dead end. The name is asked for, never made up.
    Future<void> createAndAdd() async {
      final client = ref.read(apiClientProvider);
      if (client == null) return;
      // Captured before the awaits/pop, so the SnackBar still has a
      // messenger after the dialog's context is gone.
      final messenger = ScaffoldMessenger.of(context);
      final name = await promptPlaylistName(context);
      if (name == null) return;
      try {
        final playlist = await client.createPlaylist(name);
        await client.addSongToPlaylist(playlist.id, songId);
        ref.invalidate(playlistsProvider);
        ref.invalidate(playlistDetailProvider(playlist.id));
        messenger.showSnackBar(_snack('Added to "$name"'));
      } catch (_) {
        messenger.showSnackBar(_snack('Failed to add to playlist'));
      }
      if (context.mounted) Navigator.pop(context);
    }

    return AlertDialog(
      title: const Text('Add to playlist'),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.add),
              title: const Text('New playlist'),
              enabled: !playlistsAsync.isLoading,
              onTap: createAndAdd,
            ),
            Flexible(
              child: playlistsAsync.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (e, _) => Text('Error: $e'),
                data: (playlists) => playlists.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Text('No playlists yet',
                            style: TextStyle(color: AppColors.muted)),
                      )
                    : ListView.builder(
                        shrinkWrap: true,
                        itemCount: playlists.length,
                        itemBuilder: (_, i) {
                          final pl = playlists[i];
                          return ListTile(
                            title:
                                Text(pl.name, overflow: TextOverflow.ellipsis),
                            onTap: () async {
                              final client = ref.read(apiClientProvider);
                              if (client == null) return;
                              // Captured before the await/pop, so the
                              // SnackBar still has a messenger after the
                              // dialog's context is gone.
                              final messenger = ScaffoldMessenger.of(context);
                              // Subsonic itself allows duplicate entries, so
                              // the check lives here: a song already in the
                              // playlist isn't added again, just flagged.
                              String message;
                              try {
                                final current = await client.getPlaylist(pl.id);
                                final exists = (current.entries ?? const [])
                                    .any((s) => s.id == songId);
                                if (exists) {
                                  message = 'Already in "${pl.name}"';
                                } else {
                                  await client.addSongToPlaylist(pl.id, songId);
                                  ref.invalidate(playlistDetailProvider(pl.id));
                                  message = 'Added to "${pl.name}"';
                                }
                              } catch (_) {
                                message = 'Failed to add to playlist';
                              }
                              if (context.mounted) Navigator.pop(context);
                              messenger.showSnackBar(_snack(message));
                            },
                          );
                        },
                      ),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}
