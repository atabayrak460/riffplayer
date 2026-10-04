import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';
import '../app_colors.dart';

class AddToPlaylistDialog extends ConsumerWidget {
  final String songId;
  const AddToPlaylistDialog({super.key, required this.songId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlistsAsync = ref.watch(playlistsProvider);

    // Previously this dialog could only add to an *existing* playlist — with
    // none created yet it was a dead end, no way to get the song into a
    // playlist without leaving the dialog, creating one blank from the
    // Library screen, then coming back. Same default-naming convention as
    // that screen's own "new playlist" action.
    Future<void> createAndAdd() async {
      final client = ref.read(apiClientProvider);
      if (client == null) return;
      final count = playlistsAsync.valueOrNull?.length ?? 0;
      final name = count > 0 ? 'New Playlist ${count + 1}' : 'New Playlist';
      final playlist = await client.createPlaylist(name);
      await client.addSongToPlaylist(playlist.id, songId);
      ref.invalidate(playlistsProvider);
      ref.invalidate(playlistDetailProvider(playlist.id));
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
            playlistsAsync.when(
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
                          title: Text(pl.name, overflow: TextOverflow.ellipsis),
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
                            final current = await client.getPlaylist(pl.id);
                            final exists = (current.entries ?? const [])
                                .any((s) => s.id == songId);
                            if (!exists) {
                              await client.addSongToPlaylist(pl.id, songId);
                              ref.invalidate(playlistDetailProvider(pl.id));
                            }
                            if (context.mounted) Navigator.pop(context);
                            if (exists) {
                              messenger.showSnackBar(SnackBar(
                                content: Text('Already in "${pl.name}"'),
                                duration: const Duration(seconds: 2),
                              ));
                            }
                          },
                        );
                      },
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
