import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_colors.dart';
import '../providers/providers.dart';
import '../utils/quality.dart';
import '../widgets/quality_badge.dart';
import 'tv_widgets.dart';

/// The big player: the cover, what is playing, progress, and previous / play-pause / next.
class TvNowPlayingScreen extends ConsumerWidget {
  const TvNowPlayingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final player = ref.watch(playerProvider);
    final song = player.currentSong;
    final notifier = ref.read(playerProvider.notifier);
    final client = ref.read(apiClientProvider);

    if (song == null) {
      return const Scaffold(body: TvMessage('Nothing is playing.'));
    }
    final cover = song.coverArt != null
        ? client?.coverArtUrl(song.coverArt!, size: 900)
        : null;
    final total = player.duration.inMilliseconds;
    final progress = total > 0 ? player.position.inMilliseconds / total : 0.0;

    Widget control(IconData icon, VoidCallback onTap,
            {bool autofocus = false, double size = 44}) =>
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: TvFocusable(
            autofocus: autofocus,
            borderRadius: 40,
            onActivate: onTap,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Icon(icon, size: size, color: AppColors.text),
            ),
          ),
        );

    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(56),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: SizedBox(
                width: 520,
                height: 520,
                child: cover == null
                    ? Container(color: AppColors.surface)
                    : Image.network(cover, fit: BoxFit.cover),
              ),
            ),
            const SizedBox(width: 56),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(song.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color: AppColors.text,
                          fontSize: 44,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(song.artist,
                      style: TextStyle(
                          color: AppColors.textSecondary, fontSize: 28)),
                  if (song.album.isNotEmpty)
                    Text(song.album,
                        style: TextStyle(color: AppColors.muted, fontSize: 22)),
                  const SizedBox(height: 12),
                  if (audioQuality(song).label != null)
                    QualityBadge(song: song),
                  const SizedBox(height: 32),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: progress.clamp(0.0, 1.0),
                      minHeight: 8,
                      backgroundColor: AppColors.surface2,
                      color: AppColors.brand,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(tvFormatDuration(player.position),
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 18)),
                      Text(tvFormatDuration(player.duration),
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 18)),
                    ],
                  ),
                  const SizedBox(height: 24),
                  FocusTraversalGroup(
                    child: Row(
                      children: [
                        control(Icons.skip_previous, notifier.previous),
                        control(
                          player.playing
                              ? Icons.pause_circle
                              : Icons.play_circle,
                          () => player.playing
                              ? notifier.pause()
                              : notifier.play(),
                          autofocus: true,
                          size: 72,
                        ),
                        control(Icons.skip_next, notifier.next),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
