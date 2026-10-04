import '../providers/radio_provider.dart';
import '../utils/radio_actions.dart';
import '../utils/share_actions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../utils/snackbar.dart';
import '../widgets/cover_art.dart';
import '../widgets/song_tile.dart';
import '../widgets/stock_covers.dart' as stock;
import '../app_colors.dart';

enum PlaylistSortMode { custom, addedAsc, addedDesc }

String _fmtDuration(int seconds) {
  final h = seconds ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  return h > 0 ? '$h hr $m min' : '$m min';
}

@visibleForTesting
List<Song> sortPlaylistSongs(
    List<Song> songs, Map<String, DateTime>? dates, PlaylistSortMode mode) {
  if (mode == PlaylistSortMode.custom || dates == null) return songs;
  // Songs without a known date can't be ordered against the rest — treating
  // them as "equal" to everything would make the comparator inconsistent and
  // scramble the dated songs too. Sort only the dated ones and keep the
  // undated ones last, in their original relative order.
  final dated = songs.where((s) => dates[s.id] != null).toList();
  final undated = songs.where((s) => dates[s.id] == null);
  dated.sort((a, b) {
    final da = dates[a.id]!;
    final db = dates[b.id]!;
    return mode == PlaylistSortMode.addedAsc
        ? da.compareTo(db)
        : db.compareTo(da);
  });
  return [...dated, ...undated];
}

class PlaylistDetailScreen extends ConsumerStatefulWidget {
  final String playlistId;
  const PlaylistDetailScreen({super.key, required this.playlistId});

  @override
  ConsumerState<PlaylistDetailScreen> createState() =>
      _PlaylistDetailScreenState();
}

class _PlaylistDetailScreenState extends ConsumerState<PlaylistDetailScreen> {
  PlaylistSortMode _sortMode = PlaylistSortMode.custom;
  bool _downloading = false;
  int _downloadedCount = 0;
  int _downloadTotal = 0;

  @override
  Widget build(BuildContext context) {
    final playlistAsync = ref.watch(playlistDetailProvider(widget.playlistId));
    final datesAsync = ref.watch(playlistTrackDatesProvider(widget.playlistId));
    final client = ref.read(apiClientProvider);

    return playlistAsync.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (e, _) => Scaffold(body: Center(child: Text('Error: $e'))),
      data: (playlist) {
        final songs = playlist.entries ?? [];
        final dates = datesAsync.valueOrNull;
        final displayed = sortPlaylistSongs(songs, dates, _sortMode);
        final coverUrl = playlist.coverArt != null
            ? client?.coverArtUrl(playlist.coverArt!, size: 400)
            : null;

        return Scaffold(
          appBar: AppBar(
            title: Text(playlist.name),
            actions: [
              IconButton(
                icon: const Icon(Icons.ios_share),
                tooltip: 'Share as picture',
                onPressed: () => sharePlaylistAsPicture(context, ref, playlist),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _confirmDelete(context, ref, playlist),
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                child: GestureDetector(
                  onTap: () => _pickCover(context, ref),
                  child: Stack(
                    children: [
                      SizedBox(
                        width: 180,
                        height: 180,
                        child: CoverArt(
                          url: coverUrl,
                          size: null,
                          borderRadius: BorderRadius.circular(12),
                          fallback: const stock.PlaylistCover(size: null),
                        ),
                      ),
                      Positioned(
                        right: 6,
                        bottom: 6,
                        child: Container(
                          padding: const EdgeInsets.all(6),
                          decoration: const BoxDecoration(
                            color: Colors.black54,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.edit,
                              color: Colors.white, size: 16),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
              GestureDetector(
                onTap: () => _editName(context, ref, playlist),
                child: Text(
                  playlist.name,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AppColors.text,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${playlist.owner} · ${songs.length} tracks'
                '${songs.isNotEmpty ? ' · ${_fmtDuration(playlist.duration)}' : ''}',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 13),
              ),
              const SizedBox(height: 12),
              GestureDetector(
                onTap: () => _editDescription(context, ref, playlist),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.background,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    playlist.comment?.isNotEmpty == true
                        ? playlist.comment!
                        : 'Add a description…',
                    style: TextStyle(
                      color: playlist.comment?.isNotEmpty == true
                          ? AppColors.mutedLight
                          : AppColors.border,
                      fontSize: 13,
                      fontStyle: playlist.comment?.isNotEmpty == true
                          ? FontStyle.normal
                          : FontStyle.italic,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  ElevatedButton.icon(
                    onPressed: songs.isEmpty
                        ? null
                        : () {
                            final client = ref.read(apiClientProvider);
                            final downloads = ref.read(downloadServiceProvider);
                            if (client == null) return;
                            ref.read(playerProvider.notifier).playSong(
                                  displayed.first,
                                  client,
                                  downloads,
                                  queue: displayed,
                                  queueIndex: 0,
                                );
                          },
                    icon: const Icon(Icons.play_arrow, size: 18),
                    label: const Text('Play'),
                  ),
                  const SizedBox(width: 8),
                  RadioButton(
                    seed: RadioSeed('playlist', playlist.id, playlist.name),
                    enabled: songs.isNotEmpty,
                  ),
                  const SizedBox(width: 4),
                  OutlinedButton.icon(
                    onPressed: songs.isEmpty || _downloading
                        ? null
                        : () => _downloadAll(context, ref, playlist, songs),
                    icon: _downloading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download, size: 18),
                    label: Text(_downloading
                        ? 'Downloading $_downloadedCount/$_downloadTotal…'
                        : 'Download'),
                  ),
                ],
              ),
              if (songs.isNotEmpty) ...[
                const SizedBox(height: 20),
                Row(
                  children: [
                    _SortChip(
                      label: 'Custom order',
                      selected: _sortMode == PlaylistSortMode.custom,
                      onTap: () =>
                          setState(() => _sortMode = PlaylistSortMode.custom),
                    ),
                    const SizedBox(width: 6),
                    _SortChip(
                      label: 'Oldest first',
                      selected: _sortMode == PlaylistSortMode.addedAsc,
                      onTap: () =>
                          setState(() => _sortMode = PlaylistSortMode.addedAsc),
                    ),
                    const SizedBox(width: 6),
                    _SortChip(
                      label: 'Newest first',
                      selected: _sortMode == PlaylistSortMode.addedDesc,
                      onTap: () => setState(
                          () => _sortMode = PlaylistSortMode.addedDesc),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              if (songs.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  child: Center(
                    child: Text('No tracks yet.',
                        style: TextStyle(color: AppColors.muted)),
                  ),
                )
              else if (_sortMode == PlaylistSortMode.custom)
                ReorderableListView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: songs.length,
                  onReorderItem: (oldIndex, newIndex) =>
                      _reorder(ref, songs, oldIndex, newIndex),
                  itemBuilder: (_, i) => SongTile(
                    key: ValueKey('${songs[i].id}-$i'),
                    song: songs[i],
                    queue: songs,
                    index: i,
                    showAlbum: true,
                    addedAt: dates?[songs[i].id],
                  ),
                )
              else
                ...List.generate(
                  displayed.length,
                  (i) => SongTile(
                    key: ValueKey('${displayed[i].id}-sorted-$i'),
                    song: displayed[i],
                    queue: displayed,
                    index: i,
                    showAlbum: true,
                    addedAt: dates?[displayed[i].id],
                  ),
                ),
              const SizedBox(height: 80),
            ],
          ),
        );
      },
    );
  }

  Future<void> _reorder(
      WidgetRef ref, List<Song> songs, int oldIndex, int newIndex) async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final reordered = [...songs];
    final moved = reordered.removeAt(oldIndex);
    reordered.insert(newIndex, moved);
    await client.reorderPlaylistTracks(
        widget.playlistId, reordered.map((s) => s.id).toList());
    ref.invalidate(playlistDetailProvider(widget.playlistId));
  }

  Future<void> _downloadAll(
    BuildContext context,
    WidgetRef ref,
    Playlist playlist,
    List<Song> songs,
  ) async {
    final client = ref.read(apiClientProvider);
    final downloads = ref.read(downloadServiceProvider);
    if (client == null) return;
    setState(() {
      _downloading = true;
      _downloadedCount = 0;
      _downloadTotal = songs.length;
    });
    try {
      await downloads.downloadPlaylist(
        playlist,
        songs,
        client,
        onTrackProgress: (completed, total) {
          if (!mounted) return;
          setState(() => _downloadedCount = completed);
        },
      );
      ref.invalidate(downloadedPlaylistsProvider);
      if (context.mounted) showSnackBar(context, 'Playlist downloaded');
    } catch (_) {
      if (context.mounted) {
        showFailureSnackBar(context, 'Failed to download playlist');
      }
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  Future<void> _pickCover(BuildContext context, WidgetRef ref) async {
    final picked = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 90);
    if (picked == null) return;
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    await client.uploadPlaylistCover(widget.playlistId, picked.path);
    ref.invalidate(playlistDetailProvider(widget.playlistId));
    ref.invalidate(playlistsProvider);
  }

  Future<void> _editName(
      BuildContext context, WidgetRef ref, Playlist playlist) async {
    final ctrl = TextEditingController(text: playlist.name);
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rename playlist'),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, ctrl.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty || name == playlist.name) return;
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    await client.renamePlaylist(widget.playlistId, name);
    ref.invalidate(playlistDetailProvider(widget.playlistId));
    ref.invalidate(playlistsProvider);
  }

  Future<void> _editDescription(
      BuildContext context, WidgetRef ref, Playlist playlist) async {
    final ctrl = TextEditingController(text: playlist.comment ?? '');
    final comment = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Description'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          maxLines: 3,
          decoration: const InputDecoration(hintText: 'Add a description…'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, ctrl.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (comment == null) return;
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    await client.setPlaylistDescription(widget.playlistId, comment);
    ref.invalidate(playlistDetailProvider(widget.playlistId));
  }

  Future<void> _confirmDelete(
      BuildContext context, WidgetRef ref, Playlist playlist) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete playlist?'),
        content: Text('Remove "${playlist.name}"? This cannot be undone.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('Delete', style: TextStyle(color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    await client.deletePlaylist(widget.playlistId);
    ref.invalidate(playlistsProvider);
    if (context.mounted) context.pop();
  }
}

class _SortChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _SortChip(
      {required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? AppColors.surface2 : Colors.transparent,
            borderRadius: BorderRadius.circular(100),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? AppColors.text : AppColors.muted,
              fontSize: 11.5,
            ),
          ),
        ),
      );
}
