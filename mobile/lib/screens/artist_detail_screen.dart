import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/subsonic.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../widgets/cover_art.dart';
import '../widgets/song_tile.dart';
import '../app_colors.dart';

enum _Tab { albums, songs }

class ArtistDetailScreen extends ConsumerStatefulWidget {
  final String artistId;

  /// Opens straight to the Songs tab — used by the player screen's "See
  /// all" link on an artist's other tracks, mirroring web's `?tab=songs`.
  final bool initialSongsTab;
  const ArtistDetailScreen({
    super.key,
    required this.artistId,
    this.initialSongsTab = false,
  });

  @override
  ConsumerState<ArtistDetailScreen> createState() => _ArtistDetailScreenState();
}

class _ArtistDetailScreenState extends ConsumerState<ArtistDetailScreen> {
  late _Tab _tab = widget.initialSongsTab ? _Tab.songs : _Tab.albums;

  @override
  Widget build(BuildContext context) {
    final detailAsync = ref.watch(artistDetailProvider(widget.artistId));
    final client = ref.read(apiClientProvider);

    return detailAsync.when(
      loading: () =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (e, _) => Scaffold(body: Center(child: Text('Error: $e'))),
      data: (data) {
        final artist = data.artist;
        final albums = data.albums;
        final coverUrl = artist.coverArt != null
            ? client?.coverArtUrl(artist.coverArt!, size: 300)
            : null;

        return Scaffold(
          appBar: AppBar(title: Text(artist.name)),
          body: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      CoverArt(
                        url: coverUrl,
                        size: 100,
                        borderRadius: BorderRadius.circular(50),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              artist.name,
                              style: TextStyle(
                                color: AppColors.text,
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${albums.length} ${albums.length == 1 ? 'album' : 'albums'}',
                              style: TextStyle(
                                  color: AppColors.muted, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    children: [
                      _TabChip(
                        label: 'Albums',
                        selected: _tab == _Tab.albums,
                        onTap: () => setState(() => _tab = _Tab.albums),
                      ),
                      const SizedBox(width: 8),
                      _TabChip(
                        label: 'Songs',
                        selected: _tab == _Tab.songs,
                        onTap: () => setState(() => _tab = _Tab.songs),
                      ),
                    ],
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 12)),
              if (_tab == _Tab.albums)
                _AlbumsGrid(albums: albums, client: client)
              else
                _SongsList(artistId: widget.artistId),
              const SliverToBoxAdapter(child: SizedBox(height: 100)),
            ],
          ),
        );
      },
    );
  }
}

class _TabChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _TabChip(
      {required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          decoration: BoxDecoration(
            color: selected ? AppColors.surface2 : Colors.transparent,
            borderRadius: BorderRadius.circular(100),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? AppColors.text : AppColors.muted,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      );
}

class _AlbumsGrid extends StatelessWidget {
  final List<Album> albums;
  final SubsonicClient? client;
  const _AlbumsGrid({required this.albums, required this.client});

  @override
  Widget build(BuildContext context) => SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 0.78,
        ),
        delegate: SliverChildBuilderDelegate(
          (_, i) {
            final album = albums[i];
            final aCoverUrl = album.coverArt != null
                ? client?.coverArtUrl(album.coverArt!, size: 300)
                : null;
            return GestureDetector(
              onTap: () => context.push('/albums/${album.id}'),
              child: Padding(
                padding: EdgeInsets.only(
                  left: i.isEven ? 12 : 0,
                  right: i.isOdd ? 12 : 0,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: aCoverUrl != null
                            ? Image.network(aCoverUrl,
                                fit: BoxFit.cover, width: double.infinity)
                            : Container(color: AppColors.surface),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(album.name,
                        style: TextStyle(
                            color: AppColors.text,
                            fontSize: 13,
                            fontWeight: FontWeight.w500),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    if (album.year != null)
                      Text('${album.year}',
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 12)),
                  ],
                ),
              ),
            );
          },
          childCount: albums.length,
        ),
      );
}

class _SongsList extends ConsumerWidget {
  final String artistId;
  const _SongsList({required this.artistId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final songsAsync = ref.watch(artistSongsProvider(artistId));
    return songsAsync.when(
      loading: () => const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 32),
          child: Center(child: CircularProgressIndicator()),
        ),
      ),
      error: (e, _) => SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 32),
          child: Center(child: Text('Error: $e')),
        ),
      ),
      data: (songs) => songs.isEmpty
          ? SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: Text('No songs found.',
                      style: TextStyle(color: AppColors.muted)),
                ),
              ),
            )
          : SliverList(
              delegate: SliverChildBuilderDelegate(
                (_, i) => SongTile(
                  song: songs[i],
                  queue: songs,
                  index: i,
                  showAlbum: true,
                ),
                childCount: songs.length,
              ),
            ),
    );
  }
}
