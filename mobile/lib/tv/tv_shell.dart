import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app_colors.dart';
import '../providers/providers.dart';
import 'tv_widgets.dart';

const _destinations = [
  ('/home', 'Home', Icons.home),
  ('/albums', 'Albums', Icons.album),
  ('/artists', 'Artists', Icons.people),
  ('/playlists', 'Playlists', Icons.queue_music),
  ('/settings', 'Settings', Icons.settings),
];

/// The TV's frame: a left rail you move through with the remote, the page beside it, and a
/// "now playing" bar along the bottom that opens the big player.
class TvShell extends ConsumerWidget {
  const TvShell({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).matchedLocation;
    final song = ref.watch(playerProvider.select((s) => s.currentSong));
    final playing = ref.watch(playerProvider.select((s) => s.playing));
    final client = ref.read(apiClientProvider);

    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: Row(
              children: [
                Container(
                  width: 230,
                  color: AppColors.surface,
                  padding:
                      const EdgeInsets.symmetric(vertical: 24, horizontal: 12),
                  child: FocusTraversalGroup(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 0, 0, 24),
                          child: Text('RiffPlayer',
                              style: TextStyle(
                                  color: AppColors.brand,
                                  fontSize: 28,
                                  fontWeight: FontWeight.bold)),
                        ),
                        for (final (path, label, icon) in _destinations)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: TvFocusable(
                              autofocus: path == '/home' && location == '/home',
                              onActivate: () => context.go(path),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 16, vertical: 14),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(12),
                                  color: location == path
                                      ? AppColors.surface2
                                      : Colors.transparent,
                                ),
                                child: Row(
                                  children: [
                                    Icon(icon,
                                        color: location == path
                                            ? AppColors.brand
                                            : AppColors.muted),
                                    const SizedBox(width: 14),
                                    Text(label,
                                        style: TextStyle(
                                            color: AppColors.text,
                                            fontSize: 20)),
                                  ],
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                Expanded(child: FocusTraversalGroup(child: child)),
              ],
            ),
          ),
          if (song != null)
            Container(
              color: AppColors.surface,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
              child: TvFocusable(
                onActivate: () => context.push('/now-playing'),
                child: Padding(
                  padding: const EdgeInsets.all(6),
                  child: Row(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: SizedBox(
                          width: 56,
                          height: 56,
                          child: song.coverArt == null
                              ? Container(color: AppColors.surface2)
                              : Image.network(
                                  client!
                                      .coverArtUrl(song.coverArt!, size: 120),
                                  fit: BoxFit.cover),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(song.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    color: AppColors.text,
                                    fontSize: 20,
                                    fontWeight: FontWeight.w600)),
                            Text(song.artist,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    color: AppColors.muted, fontSize: 16)),
                          ],
                        ),
                      ),
                      Icon(playing ? Icons.pause : Icons.play_arrow,
                          color: AppColors.text, size: 32),
                      const SizedBox(width: 12),
                      Text('Open',
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 16)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
