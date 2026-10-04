import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';
import '../utils/snackbar.dart';
import '../widgets/song_tile.dart';
import '../widgets/stock_covers.dart' as stock;
import '../app_colors.dart';

class FavoritesScreen extends ConsumerWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final starredAsync = ref.watch(starredProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Favourites')),
      body: starredAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (data) {
          if (data.artists.isEmpty &&
              data.albums.isEmpty &&
              data.songs.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  'Nothing starred yet.\nTap ☆ on a song, album or artist.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.muted),
                ),
              ),
            );
          }
          final total =
              data.songs.length + data.albums.length + data.artists.length;
          return ListView(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Row(
                  children: [
                    const stock.FavouritesCover(
                      size: 56,
                      borderRadius: BorderRadius.all(Radius.circular(10)),
                    ),
                    const SizedBox(width: 14),
                    Text(
                      '$total starred item${total == 1 ? '' : 's'}',
                      style: TextStyle(color: AppColors.muted, fontSize: 13),
                    ),
                  ],
                ),
              ),
              if (data.songs.isNotEmpty) ...[
                const _SectionHeader('Songs'),
                ...data.songs.map((s) => SongTile(
                      song: s,
                      queue: data.songs,
                      showAlbum: true,
                    )),
              ],
              if (data.albums.isNotEmpty) ...[
                const _SectionHeader('Albums'),
                ...data.albums.map((a) => ListTile(
                      leading: Icon(Icons.album, color: AppColors.muted),
                      title:
                          Text(a.name, style: TextStyle(color: AppColors.text)),
                      subtitle: Text(a.artist,
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 12)),
                      trailing: IconButton(
                        icon: Icon(Icons.star, color: AppColors.brand),
                        onPressed: () => ref
                            .read(apiClientProvider)
                            ?.unstar(albumId: a.id)
                            .then((_) => ref.invalidate(starredProvider))
                            .catchError((_) => showFailureSnackBar(
                                // ignore: use_build_context_synchronously
                                context,
                                'Failed to unstar'))
                            .ignore(),
                      ),
                    )),
              ],
              if (data.artists.isNotEmpty) ...[
                const _SectionHeader('Artists'),
                ...data.artists.map((a) => ListTile(
                      leading: Icon(Icons.person, color: AppColors.muted),
                      title:
                          Text(a.name, style: TextStyle(color: AppColors.text)),
                    )),
              ],
              const SizedBox(height: 80),
            ],
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
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
