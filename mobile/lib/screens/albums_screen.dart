import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/providers.dart';
import '../api/types.dart';
import '../app_colors.dart';
import '../providers/theme_provider.dart';
import '../widgets/cover_flow.dart';
import '../widgets/quality_filter_menu.dart';

class AlbumsScreen extends ConsumerStatefulWidget {
  const AlbumsScreen({super.key});

  @override
  ConsumerState<AlbumsScreen> createState() => _AlbumsScreenState();
}

class _AlbumsScreenState extends ConsumerState<AlbumsScreen> {
  String _type = 'newest';
  // Cover Flow is the iPod style's way of browsing; anyone can switch to it.
  bool? _coverFlow;
  String? _quality;

  static const _types = [
    ('newest', 'Recently Added'),
    ('recent', 'Recently Played'),
    ('frequent', 'Most Played'),
    ('starred', 'Starred'),
    ('alphabeticalByName', 'A–Z'),
    ('alphabeticalByArtist', 'By Artist'),
    ('random', 'Random'),
  ];

  @override
  Widget build(BuildContext context) {
    final albumsAsync =
        ref.watch(filteredAlbumListProvider((type: _type, quality: _quality)));
    final coverFlow = _coverFlow ?? ref.watch(skinProvider) == AppSkin.ipod;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Albums'),
        actions: [
          IconButton(
            tooltip: coverFlow ? 'Grid view' : 'Cover Flow',
            icon: Icon(coverFlow ? Icons.grid_view : Icons.view_carousel),
            onPressed: () => setState(() => _coverFlow = !coverFlow),
          ),
          QualityFilterMenu(
            value: _quality,
            onChanged: (q) => setState(() => _quality = q),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.sort),
            onSelected: (v) => setState(() => _type = v),
            itemBuilder: (_) => _types
                .map((t) => PopupMenuItem(
                      value: t.$1,
                      child: Text(t.$2),
                    ))
                .toList(),
          ),
        ],
      ),
      body: albumsAsync.when(
        loading: () => _skeleton(),
        error: (e, _) => Center(
          child: Text('Error: $e', style: TextStyle(color: AppColors.danger)),
        ),
        data: (albums) => albums.isEmpty
            ? Center(
                child: Text(
                  'No albums found.\nAdd a library in the admin panel.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.muted),
                ),
              )
            : coverFlow
                ? CoverFlow(
                    albums: albums,
                    coverUrl: (a, size) => a.coverArt == null
                        ? null
                        : ref
                            .read(apiClientProvider)
                            ?.coverArtUrl(a.coverArt!, size: size),
                    onOpen: (a) => context.push('/albums/${a.id}'),
                    onPlay: _playAlbum,
                  )
                : GridView.builder(
                    padding: const EdgeInsets.all(12),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                      childAspectRatio: 0.78,
                    ),
                    itemCount: albums.length,
                    itemBuilder: (_, i) => _AlbumCard(album: albums[i]),
                  ),
      ),
    );
  }

  Future<void> _playAlbum(Album album) async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final downloads = ref.read(downloadServiceProvider);
    try {
      final result = await client.getAlbum(album.id);
      if (result.songs.isEmpty) return;
      await ref.read(playerProvider.notifier).playSong(
            result.songs.first,
            client,
            downloads,
            queue: result.songs,
            queueIndex: 0,
          );
    } catch (_) {
      // Playback errors surface through the player itself.
    }
  }

  Widget _skeleton() => GridView.builder(
        padding: const EdgeInsets.all(12),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 0.78,
        ),
        itemCount: 12,
        itemBuilder: (_, __) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Container(height: 12, width: 100, color: AppColors.surface),
            const SizedBox(height: 4),
            Container(height: 10, width: 70, color: AppColors.surface),
          ],
        ),
      );
}

class _AlbumCard extends ConsumerWidget {
  final Album album;
  const _AlbumCard({required this.album});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final coverUrl = album.coverArt != null
        ? client?.coverArtUrl(album.coverArt!, size: 300)
        : null;

    return GestureDetector(
      onTap: () => context.push('/albums/${album.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: coverUrl != null
                  ? CachedNetworkImage(
                      imageUrl: coverUrl,
                      fit: BoxFit.cover,
                      width: double.infinity,
                      placeholder: (_, __) =>
                          Container(color: AppColors.surface),
                      errorWidget: (_, __, ___) => Container(
                        color: AppColors.surface,
                        child: Icon(Icons.music_note,
                            color: AppColors.border, size: 48),
                      ),
                    )
                  : Container(
                      color: AppColors.surface,
                      child: Icon(Icons.music_note,
                          color: AppColors.border, size: 48),
                    ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            album.name,
            style: TextStyle(
                color: AppColors.text,
                fontSize: 13,
                fontWeight: FontWeight.w500),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          Text(
            album.artist,
            style: TextStyle(color: AppColors.muted, fontSize: 12),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
