import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/providers.dart';
import '../api/types.dart';
import '../widgets/download_tile.dart';
import '../widgets/stock_covers.dart' as stock;
import '../app_colors.dart';

class DownloadsScreen extends ConsumerWidget {
  const DownloadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final downloadsAsync = ref.watch(downloadsProvider);
    final playlistsAsync = ref.watch(downloadedPlaylistsProvider);
    final downloadedPlaylists = playlistsAsync.valueOrNull ?? [];

    return Scaffold(
      appBar: AppBar(title: const Text('Downloads')),
      body: downloadsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (downloads) => downloads.isEmpty && downloadedPlaylists.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Text(
                    'No downloaded tracks.\nTap "⋯" on a song and select "Download".',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.muted),
                  ),
                ),
              )
            : ListView(
                children: [
                  if (downloadedPlaylists.isNotEmpty) ...[
                    const _SectionHeader('Downloaded Playlists'),
                    ...downloadedPlaylists.map(
                      (pl) => _DownloadedPlaylistRow(playlist: pl),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Divider(color: AppColors.surface, height: 1),
                    ),
                  ],
                  if (downloads.isNotEmpty) ...[
                    const _SectionHeader('Downloaded Songs'),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: Row(
                        children: [
                          const stock.DownloadedCover(
                            size: 40,
                            borderRadius: BorderRadius.all(Radius.circular(8)),
                          ),
                          const SizedBox(width: 12),
                          Text(
                            '${downloads.length} track${downloads.length == 1 ? '' : 's'} available offline',
                            style:
                                TextStyle(color: AppColors.muted, fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                    ...downloads.asMap().entries.map(
                          (e) => DownloadTile(
                            track: e.value,
                            onTap: () {
                              final client = ref.read(apiClientProvider);
                              if (client == null) return;
                              final downloadService =
                                  ref.read(downloadServiceProvider);
                              final queue = downloads
                                  .map(songFromDownloadedTrack)
                                  .toList();
                              ref.read(playerProvider.notifier).playSong(
                                    queue[e.key],
                                    client,
                                    downloadService,
                                    queue: queue,
                                    queueIndex: e.key,
                                  );
                            },
                            onDelete: () async {
                              await ref
                                  .read(downloadServiceProvider)
                                  .deleteDownload(e.value.trackId);
                              ref.invalidate(downloadsProvider);
                            },
                          ),
                        ),
                  ],
                  const SizedBox(height: 24),
                ],
              ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Text(
          title.toUpperCase(),
          style: TextStyle(
            color: AppColors.muted,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.2,
          ),
        ),
      );
}

class _DownloadedPlaylistRow extends StatelessWidget {
  final DownloadedPlaylist playlist;
  const _DownloadedPlaylistRow({required this.playlist});

  @override
  Widget build(BuildContext context) => ListTile(
        onTap: () =>
            context.push('/downloads/playlists/${playlist.playlistId}'),
        leading: _PlaylistCoverThumb(playlist: playlist),
        title: Text(
          playlist.name,
          style: TextStyle(color: AppColors.text, fontSize: 14),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          '${playlist.trackCount} track${playlist.trackCount == 1 ? '' : 's'}',
          style: TextStyle(color: AppColors.muted, fontSize: 12),
        ),
        trailing: Icon(Icons.chevron_right, color: AppColors.border),
      );
}

class _PlaylistCoverThumb extends StatelessWidget {
  final DownloadedPlaylist playlist;
  const _PlaylistCoverThumb({required this.playlist});

  @override
  Widget build(BuildContext context) {
    final path = playlist.coverLocalPath;
    if (path == null || !File(path).existsSync()) {
      return Icon(Icons.queue_music, color: AppColors.muted);
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(6),
      child: Image.file(File(path), width: 44, height: 44, fit: BoxFit.cover),
    );
  }
}
