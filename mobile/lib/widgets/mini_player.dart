import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/subsonic.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../connect/connect_provider.dart';
import 'device_picker.dart';
import 'cover_art.dart';
import '../app_colors.dart';

// Swipe-left/right thresholds for skipping tracks — a swipe past either one
// (distance OR flick velocity) fires; short/slow drags snap back to 0. Kept
// low so a normal swipe-and-release reads as an instant skip, not a drag you
// have to fully commit to.
const _swipeDistanceThreshold = 45.0;
const _swipeVelocityThreshold = 250.0;
// Upward flick speed (px/s) that opens the full player.
const _openPlayerVelocity = 300.0;

class MiniPlayer extends ConsumerStatefulWidget {
  const MiniPlayer({super.key});

  @override
  ConsumerState<MiniPlayer> createState() => _MiniPlayerState();
}

class _MiniPlayerState extends ConsumerState<MiniPlayer>
    with SingleTickerProviderStateMixin {
  // Built eagerly in initState(), not as a lazy `late final` field — build()
  // returns early (SizedBox.shrink()) without ever touching this whenever
  // nothing is playing, so a lazy initializer wouldn't run until dispose()
  // called .dispose() on it for the first time, which tries to look up this
  // element's TickerMode ancestor mid-unmount and crashes.
  late final AnimationController _snapBackController;
  Animation<double> _snapBack = const AlwaysStoppedAnimation(0);

  bool _dragging = false;
  double _dragDx = 0;

  double get _offsetDx => _dragging ? _dragDx : _snapBack.value;

  @override
  void initState() {
    super.initState();
    _snapBackController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 180),
    )..addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _snapBackController.dispose();
    super.dispose();
  }

  void _onDragStart(DragStartDetails _) {
    _snapBackController.stop();
    setState(() {
      _dragging = true;
      _dragDx = 0;
    });
  }

  void _onDragUpdate(DragUpdateDetails details) {
    setState(() => _dragDx += details.delta.dx);
  }

  void _onDragEnd(DragEndDetails details) {
    final dx = _dragDx;
    final velocity = details.velocity.pixelsPerSecond.dx;
    final notifier = ref.read(playerProvider.notifier);
    if (dx <= -_swipeDistanceThreshold ||
        velocity <= -_swipeVelocityThreshold) {
      notifier.next();
    } else if (dx >= _swipeDistanceThreshold ||
        velocity >= _swipeVelocityThreshold) {
      notifier.previous();
    }
    _snapBack = Tween<double>(begin: dx, end: 0).animate(
      CurvedAnimation(parent: _snapBackController, curve: Curves.easeOut),
    );
    setState(() => _dragging = false);
    _snapBackController.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    // Scoped to just the fields this widget actually shows — otherwise it
    // also rebuilds on unrelated state changes like shuffle/repeat that have
    // no visible effect on the mini player. queue/currentIndex are needed
    // now too, to peek at the next/previous track while dragging.
    final (song, playing, position, duration, queue, currentIndex) =
        ref.watch(playerProvider.select(
      (s) => (
        s.currentSong,
        s.playing,
        s.position,
        s.duration,
        s.queue,
        s.currentIndex,
      ),
    ));
    if (song == null) return const SizedBox.shrink();

    final client = ref.read(apiClientProvider);
    final remote = remoteLabel(ref.watch(connectProvider));
    final nextSong =
        currentIndex + 1 < queue.length ? queue[currentIndex + 1] : null;
    final prevSong = currentIndex > 0 ? queue[currentIndex - 1] : null;
    final progress = duration.inMilliseconds > 0
        ? position.inMilliseconds / duration.inMilliseconds
        : 0.0;
    final dx = _offsetDx;

    return GestureDetector(
      onTap: () => context.push('/player'),
      onHorizontalDragStart: _onDragStart,
      onHorizontalDragUpdate: _onDragUpdate,
      onHorizontalDragEnd: _onDragEnd,
      // Flick the bar upward to open the full player (the same motion that
      // pulls the player back down closes it).
      onVerticalDragEnd: (d) {
        if (d.velocity.pixelsPerSecond.dy <= -_openPlayerVelocity) {
          context.push('/player');
        }
      },
      behavior: HitTestBehavior.opaque,
      child: Container(
        color: AppColors.surface,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Progress bar
            LinearProgressIndicator(
              value: progress.clamp(0.0, 1.0),
              backgroundColor: AppColors.surface2,
              valueColor: AlwaysStoppedAnimation(
                Theme.of(context).colorScheme.primary,
              ),
              minHeight: 2,
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  // Only this part (cover + title/artist) moves with the
                  // swipe — the transport buttons stay put. Dragging past
                  // the next/previous track's cover peeking in from the
                  // opposite edge, like a card being swapped out.
                  Expanded(
                    child: SizedBox(
                      height: 44,
                      child: ClipRect(
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            final pitch = constraints.maxWidth;
                            return Stack(
                              children: [
                                if (dx < 0 && nextSong != null)
                                  Positioned.fill(
                                    child: Transform.translate(
                                      offset: Offset(dx + pitch, 0),
                                      child: _MiniSongInfo(
                                          song: nextSong, client: client),
                                    ),
                                  ),
                                if (dx > 0 && prevSong != null)
                                  Positioned.fill(
                                    child: Transform.translate(
                                      offset: Offset(dx - pitch, 0),
                                      child: _MiniSongInfo(
                                          song: prevSong, client: client),
                                    ),
                                  ),
                                Positioned.fill(
                                  child: Transform.translate(
                                    offset: Offset(dx, 0),
                                    child: _MiniSongInfo(
                                        song: song,
                                        client: client,
                                        remoteText: remote?.text),
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: Icon(Icons.skip_previous, color: AppColors.text),
                    onPressed: () =>
                        ref.read(playerProvider.notifier).previous(),
                  ),
                  IconButton(
                    icon: Icon(
                      playing ? Icons.pause : Icons.play_arrow,
                      color: AppColors.text,
                      size: 28,
                    ),
                    onPressed: () {
                      final notifier = ref.read(playerProvider.notifier);
                      playing ? notifier.pause() : notifier.play();
                    },
                  ),
                  IconButton(
                    icon: Icon(Icons.skip_next, color: AppColors.text),
                    onPressed: () => ref.read(playerProvider.notifier).next(),
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

/// Cover + title/artist block for a single track — used for the current
/// track and for the next/previous track peeking in from the edge while the
/// mini player is being dragged.
class _MiniSongInfo extends StatelessWidget {
  final Song song;
  final SubsonicClient? client;

  /// "Playing on <device>" while another device is the one playing.
  final String? remoteText;

  const _MiniSongInfo(
      {required this.song, required this.client, this.remoteText});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        CoverArt(
          // 100, not 56 — matches the ~2.3x ratio used for every other 44px
          // thumbnail elsewhere (song_tile.dart, library_list_row.dart) for
          // consistency on high-DPI.
          url: song.coverArt != null
              ? client?.coverArtUrl(song.coverArt!, size: 100)
              : null,
          size: 44,
          borderRadius: BorderRadius.circular(4),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                song.title,
                style: TextStyle(
                  color: AppColors.text,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              Text(
                remoteText == null
                    ? song.artist
                    : '${song.artist} · $remoteText',
                style: TextStyle(
                  color: AppColors.muted,
                  fontSize: 12,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ],
    );
  }
}
