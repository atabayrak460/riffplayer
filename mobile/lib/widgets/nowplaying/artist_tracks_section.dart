import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/types.dart';
import '../../providers/providers.dart';
import '../song_tile.dart';
import '../../app_colors.dart';

const _cap = 8;

/// Mirrors web's NowPlayingPanel ArtistTracksSection — other tracks by the
/// current song's artist, capped with a "See all" link into the artist's
/// Songs tab. Player screen equivalent of #68.
class ArtistTracksSection extends ConsumerWidget {
  final Song song;
  const ArtistTracksSection({super.key, required this.song});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final songsAsync = ref.watch(artistSongsProvider(song.artistId));

    return songsAsync.maybeWhen(
      data: (songs) {
        final others = songs.where((t) => t.id != song.id).toList();
        if (others.isEmpty) return const SizedBox.shrink();
        final shown = others.take(_cap).toList();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 4, 4),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'MORE FROM THIS ARTIST',
                    style: TextStyle(
                      color: AppColors.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.1,
                    ),
                  ),
                  if (others.length > _cap)
                    TextButton(
                      // .go(), not .push(): the artist page may already be
                      // underneath the player screen in the stack (e.g. got
                      // here by tapping a song from that artist's own page)
                      // — pushing a duplicate crashes with a duplicate-
                      // GlobalKey assertion, same reasoning as the artist
                      // name tap in player_screen.dart.
                      onPressed: () =>
                          context.go('/artists/${song.artistId}?tab=songs'),
                      child:
                          const Text('See all', style: TextStyle(fontSize: 12)),
                    ),
                ],
              ),
            ),
            ...shown.map((track) => SongTile(
                  song: track,
                  queue: others,
                  index: others.indexWhere((t) => t.id == track.id),
                  showAlbum: true,
                )),
          ],
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }
}
