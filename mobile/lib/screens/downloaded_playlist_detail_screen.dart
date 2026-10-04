import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../widgets/download_tile.dart';
import '../app_colors.dart';

/// Offline-only detail view for a playlist downloaded as a unit (see
/// [DownloadService.downloadPlaylist]) — reached from the Downloads screen's
/// "Downloaded Playlists" section. Everything here comes from local
/// storage; there's no live server fetch anywhere on this screen.
class DownloadedPlaylistDetailScreen extends ConsumerWidget {
  final String playlistId;
  const DownloadedPlaylistDetailScreen({super.key, required this.playlistId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlistAsync = ref.watch(downloadedPlaylistProvider(playlistId));
    final tracksAsync = ref.watch(downloadedPlaylistTracksProvider(playlistId));

    return Scaffold(
      appBar: AppBar(
        title: Text(playlistAsync.valueOrNull?.name ?? 'Playlist'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Delete downloaded playlist',
            onPressed: () => _confirmDelete(context, ref),
          ),
        ],
      ),
      body: playlistAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (playlist) {
          if (playlist == null) {
            return Center(
              child: Text('This downloaded playlist is gone.',
                  style: TextStyle(color: AppColors.muted)),
            );
          }
          final tracks = tracksAsync.valueOrNull ?? [];

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(child: _PlaylistCover(playlist: playlist)),
              const SizedBox(height: 16),
              Text(
                playlist.name,
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: AppColors.text,
                    fontSize: 20,
                    fontWeight: FontWeight.bold),
              ),
              if (playlist.comment?.isNotEmpty == true) ...[
                const SizedBox(height: 8),
                Text(
                  playlist.comment!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: AppColors.mutedLight, fontSize: 13, height: 1.4),
                ),
              ],
              const SizedBox(height: 8),
              Text(
                '${tracks.length} track${tracks.length == 1 ? '' : 's'} available offline',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              if (tracks.isNotEmpty) ...[
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: () => _playAll(ref, tracks),
                  icon: const Icon(Icons.play_arrow, size: 18),
                  label: const Text('Play'),
                ),
              ],
              const SizedBox(height: 16),
              ...tracks.asMap().entries.map(
                    (e) => DownloadTile(
                      track: e.value,
                      onTap: () => _playFrom(ref, tracks, e.key),
                      onDelete: () async {
                        await ref
                            .read(downloadServiceProvider)
                            .deleteDownload(e.value.trackId);
                        ref.invalidate(
                            downloadedPlaylistTracksProvider(playlistId));
                        ref.invalidate(downloadedPlaylistsProvider);
                        ref.invalidate(downloadsProvider);
                      },
                    ),
                  ),
              const SizedBox(height: 24),
            ],
          );
        },
      ),
    );
  }

  void _playAll(WidgetRef ref, List<DownloadedTrack> tracks) =>
      _playFrom(ref, tracks, 0);

  void _playFrom(WidgetRef ref, List<DownloadedTrack> tracks, int index) {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final downloads = ref.read(downloadServiceProvider);
    final queue = tracks.map(songFromDownloadedTrack).toList();
    ref.read(playerProvider.notifier).playSong(
          queue[index],
          client,
          downloads,
          queue: queue,
          queueIndex: index,
        );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete downloaded playlist?'),
        content: const Text(
            'Removes this playlist\'s offline copy. Tracks also downloaded '
            'on their own, or as part of another downloaded playlist, are '
            'kept.'),
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

    await ref
        .read(downloadServiceProvider)
        .deleteDownloadedPlaylist(playlistId);
    ref.invalidate(downloadedPlaylistsProvider);
    ref.invalidate(downloadsProvider);
    if (context.mounted) context.pop();
  }
}

class _PlaylistCover extends StatelessWidget {
  final DownloadedPlaylist playlist;
  const _PlaylistCover({required this.playlist});

  @override
  Widget build(BuildContext context) {
    final path = playlist.coverLocalPath;
    final radius = BorderRadius.circular(12);
    if (path == null || !File(path).existsSync()) {
      return ClipRRect(
        borderRadius: radius,
        child: Container(
          width: 160,
          height: 160,
          color: AppColors.surface,
          child: Icon(Icons.queue_music, color: AppColors.border, size: 56),
        ),
      );
    }
    return ClipRRect(
      borderRadius: radius,
      child: Image.file(File(path), width: 160, height: 160, fit: BoxFit.cover),
    );
  }
}
