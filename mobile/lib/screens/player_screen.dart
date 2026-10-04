import '../utils/share_actions.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:just_audio/just_audio.dart';
import '../api/subsonic.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../utils/snackbar.dart';
import '../widgets/cover_art.dart';
import '../widgets/lyrics_view.dart';
import '../widgets/quality_badge.dart';
import '../widgets/nowplaying/album_tracks_section.dart';
import '../widgets/nowplaying/artist_tracks_section.dart';
import '../widgets/device_picker.dart';
import '../widgets/nowplaying/up_next_section.dart';
import '../app_colors.dart';

String _fmt(Duration d) {
  final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  return '$m:$s';
}

class PlayerScreen extends ConsumerStatefulWidget {
  const PlayerScreen({super.key});

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen>
    with TickerProviderStateMixin {
  // The screen has two independent gestures:
  //  * cover art / lyrics: horizontal drags skip to the next/previous track;
  //  * anywhere on the screen: a downward drag that starts while the content
  //    is scrolled to the top pulls the whole screen down and closes it.
  // The second one is read from raw pointer events (a Listener) rather than a
  // gesture recognizer, so it works over any child — including the scroll view
  // and the buttons — without fighting them for the gesture arena.
  static const _horizontalDistanceThreshold = 50.0;
  static const _horizontalVelocityThreshold = 250.0;
  // Movement before a direction is picked, so a finger wobble can't pick the wrong axis.
  static const _axisLockSlop = 8.0;
  static const _dismissDistance = 120.0;
  static const _dismissVelocity = 700.0;

  late final AnimationController _snapBackController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 200),
  )..addListener(() => setState(() {}));
  Animation<double> _snapBack = const AlwaysStoppedAnimation(0.0);
  bool _dragging = false;
  double _dragDx = 0;

  double get _dx => _dragging ? _dragDx : _snapBack.value;

  // Pull-down-to-close state.
  late final AnimationController _dismissSnapController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 220),
  )..addListener(() => setState(() => _dismissDy = _dismissSnap.value));
  Animation<double> _dismissSnap = const AlwaysStoppedAnimation(0.0);
  final ScrollController _scroll = ScrollController();
  final GlobalKey _coverKey = GlobalKey();
  final VelocityTracker _velocity =
      VelocityTracker.withKind(PointerDeviceKind.touch);
  int? _pointer;
  bool _startedAtTop = false;
  Offset _total = Offset.zero;
  bool _dismissing = false; // a pull-down is in progress (locked to vertical)
  bool _lockedOther = false; // the drag turned out horizontal / upward
  double _dismissDy = 0;

  @override
  void dispose() {
    _snapBackController.dispose();
    _dismissSnapController.dispose();
    _scroll.dispose();
    super.dispose();
  }

  // ── Cover: horizontal skip ────────────────────────────────────────────────

  void _onHDragStart(DragStartDetails details) {
    _snapBackController.stop();
    setState(() {
      _dragging = true;
      _dragDx = 0;
    });
  }

  void _onHDragUpdate(DragUpdateDetails details) {
    setState(() => _dragDx += details.delta.dx);
  }

  void _onHDragEnd(DragEndDetails details) {
    final dx = _dragDx;
    final vx = details.velocity.pixelsPerSecond.dx;
    setState(() => _dragging = false);

    final notifier = ref.read(playerProvider.notifier);
    if (dx <= -_horizontalDistanceThreshold ||
        vx <= -_horizontalVelocityThreshold) {
      notifier.next();
    } else if (dx >= _horizontalDistanceThreshold ||
        vx >= _horizontalVelocityThreshold) {
      notifier.previous();
    }
    _snapBack = Tween<double>(begin: dx, end: 0).animate(
      CurvedAnimation(parent: _snapBackController, curve: Curves.easeOut),
    );
    _snapBackController.forward(from: 0);
  }

  // ── Whole screen: pull down to close ──────────────────────────────────────

  bool _insideCover(Offset global, bool showLyrics) {
    // Over the lyrics list a downward drag belongs to the list's own scrolling.
    if (!showLyrics) return false;
    final box = _coverKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.attached) return false;
    final local = box.globalToLocal(global);
    return box.size.contains(local);
  }

  void _onPointerDown(PointerDownEvent e, bool showLyrics) {
    if (_pointer != null) return; // a second finger doesn't start a new drag
    _dismissSnapController.stop();
    _pointer = e.pointer;
    _total = Offset.zero;
    _lockedOther = false;
    _velocity.addPosition(e.timeStamp, e.position);
    _startedAtTop = (!_scroll.hasClients || _scroll.offset <= 0) &&
        !_insideCover(e.position, showLyrics);
  }

  void _onPointerMove(PointerMoveEvent e) {
    if (e.pointer != _pointer) return;
    _velocity.addPosition(e.timeStamp, e.position);
    _total += e.delta;
    if (_lockedOther) return;
    if (!_dismissing) {
      if (_total.dx.abs() <= _axisLockSlop &&
          _total.dy.abs() <= _axisLockSlop) {
        return;
      }
      if (_startedAtTop && _total.dy > 0 && _total.dy.abs() > _total.dx.abs()) {
        setState(() => _dismissing = true);
      } else {
        _lockedOther = true;
        return;
      }
    }
    setState(() => _dismissDy = _total.dy.clamp(0.0, double.infinity));
  }

  void _onPointerEnd(PointerEvent e) {
    if (e.pointer != _pointer) return;
    _pointer = null;
    if (!_dismissing) return;
    final vy =
        e is PointerUpEvent ? _velocity.getVelocity().pixelsPerSecond.dy : 0.0;
    setState(() => _dismissing = false);
    if (e is PointerUpEvent &&
        (_dismissDy >= _dismissDistance || vy >= _dismissVelocity)) {
      // Leave the screen where the finger let go: the route's own slide-out
      // continues from there, so the close looks like one motion.
      context.pop();
      return;
    }
    _dismissSnap = Tween<double>(begin: _dismissDy, end: 0).animate(
      CurvedAnimation(parent: _dismissSnapController, curve: Curves.easeOut),
    );
    _dismissSnapController.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    // Scoped to just the fields this screen shows — excludes queue/
    // queueIndex, so e.g. adding a song to the queue while this screen is
    // open doesn't trigger a rebuild here.
    final (
      song,
      position,
      duration,
      shuffle,
      playing,
      repeatMode,
      queue,
      currentIndex
    ) = ref.watch(playerProvider.select(
      (s) => (
        s.currentSong,
        s.position,
        s.duration,
        s.shuffle,
        s.playing,
        s.repeatMode,
        s.queue,
        s.currentIndex,
      ),
    ));
    final client = ref.read(apiClientProvider);
    final showLyrics = ref.watch(showLyricsProvider);
    final horizontalOffset = Offset(_dx, 0);
    final nextSong = song != null && currentIndex + 1 < queue.length
        ? queue[currentIndex + 1]
        : null;
    final prevSong =
        song != null && currentIndex > 0 ? queue[currentIndex - 1] : null;

    final scaffold = Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.keyboard_arrow_down),
          onPressed: () => context.pop(),
        ),
        title: Text('Now Playing',
            style: TextStyle(fontSize: 14, color: AppColors.muted)),
        centerTitle: true,
        actions: [
          const DevicePickerButton(),
          if (song != null)
            IconButton(
              icon: const Icon(Icons.ios_share),
              tooltip: 'Share as picture',
              onPressed: () => shareSongAsPicture(context, ref, song),
            ),
          IconButton(
            icon: const Icon(Icons.queue_music),
            tooltip: 'Queue',
            onPressed: () => context.push('/queue'),
          ),
        ],
      ),
      body: song == null
          ? Center(
              child: Text('Nothing playing',
                  style: TextStyle(color: AppColors.muted)))
          : SafeArea(
              child: SingleChildScrollView(
                controller: _scroll,
                // Frozen while the screen is being pulled down, so reversing
                // the drag can't scroll the content at the same time.
                physics: _dismissing
                    ? const NeverScrollableScrollPhysics()
                    : const ClampingScrollPhysics(),
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 28),
                      child: Column(
                        children: [
                          const SizedBox(height: 16),
                          // Cover art / lyrics: horizontal drags skip tracks.
                          // (Pull-down-to-close is handled for the whole
                          // screen by the Listener at the end of build().)
                          Builder(builder: (context) {
                            final artSize =
                                MediaQuery.of(context).size.width - 56;
                            return GestureDetector(
                              key: _coverKey,
                              onHorizontalDragStart: _onHDragStart,
                              onHorizontalDragUpdate: _onHDragUpdate,
                              onHorizontalDragEnd: _onHDragEnd,
                              child: showLyrics
                                  ? Transform.translate(
                                      offset: horizontalOffset,
                                      child: LyricsView(
                                        songId: song.id,
                                        position: position,
                                        size: artSize,
                                      ),
                                    )
                                  : ClipRect(
                                      child: SizedBox(
                                        width: artSize,
                                        height: artSize,
                                        child: Stack(
                                          children: [
                                            if (horizontalOffset.dx < 0 &&
                                                nextSong != null)
                                              Positioned.fill(
                                                child: Transform.translate(
                                                  offset: Offset(
                                                      horizontalOffset.dx +
                                                          artSize,
                                                      0),
                                                  child: _PlayerCoverArt(
                                                      song: nextSong,
                                                      client: client,
                                                      size: artSize),
                                                ),
                                              ),
                                            if (horizontalOffset.dx > 0 &&
                                                prevSong != null)
                                              Positioned.fill(
                                                child: Transform.translate(
                                                  offset: Offset(
                                                      horizontalOffset.dx -
                                                          artSize,
                                                      0),
                                                  child: _PlayerCoverArt(
                                                      song: prevSong,
                                                      client: client,
                                                      size: artSize),
                                                ),
                                              ),
                                            Positioned.fill(
                                              child: Transform.translate(
                                                offset: horizontalOffset,
                                                child: _PlayerCoverArt(
                                                    song: song,
                                                    client: client,
                                                    size: artSize),
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                            );
                          }),
                          const SizedBox(height: 32),
                          // Song info
                          Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      song.title,
                                      style: TextStyle(
                                        color: AppColors.text,
                                        fontSize: 20,
                                        fontWeight: FontWeight.bold,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 4),
                                    GestureDetector(
                                      // `.go()`, not `.push()`: the artist page may
                                      // already be underneath this screen in the
                                      // stack (e.g. tapped a song from that same
                                      // artist's page to get here) — pushing a
                                      // second copy of the same route crashes with
                                      // a duplicate-GlobalKey assertion. `.go()`
                                      // rebuilds the stack fresh instead of
                                      // appending, so it can never collide.
                                      onTap: () => context
                                          .go('/artists/${song.artistId}'),
                                      child: Text(
                                        song.artist,
                                        style: TextStyle(
                                          color: Theme.of(context)
                                              .colorScheme
                                              .primary,
                                          fontSize: 15,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Align(
                                      alignment: Alignment.centerLeft,
                                      child: QualityBadge(song: song),
                                    ),
                                    const RemoteLabel(),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: Icon(
                                  showLyrics
                                      ? Icons.lyrics
                                      : Icons.lyrics_outlined,
                                  color: showLyrics
                                      ? Theme.of(context).colorScheme.primary
                                      : AppColors.muted,
                                ),
                                onPressed: () => ref
                                    .read(showLyricsProvider.notifier)
                                    .state = !showLyrics,
                              ),
                              IconButton(
                                icon: Icon(
                                  song.isStarred
                                      ? Icons.favorite
                                      : Icons.favorite_border,
                                  color: song.isStarred
                                      ? Theme.of(context).colorScheme.primary
                                      : AppColors.muted,
                                ),
                                onPressed: () {
                                  final newStarred =
                                      song.isStarred ? null : 'true';
                                  final future = song.isStarred
                                      ? client?.unstar(id: song.id)
                                      : client?.star(id: song.id);
                                  future?.then((_) {
                                    ref
                                        .read(playerProvider.notifier)
                                        .setStarredInQueue(song.id, newStarred);
                                    ref.invalidate(starredProvider);
                                  }).catchError((_) {
                                    final msg = song.isStarred
                                        ? 'Failed to unstar'
                                        : 'Failed to star';
                                    // ignore: use_build_context_synchronously
                                    showFailureSnackBar(context, msg);
                                  }).ignore();
                                },
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                          // Seek bar
                          Slider(
                            value: duration.inMilliseconds > 0
                                ? (position.inMilliseconds /
                                        duration.inMilliseconds)
                                    .clamp(0.0, 1.0)
                                : 0.0,
                            onChanged: (v) {
                              final target = Duration(
                                milliseconds:
                                    (v * duration.inMilliseconds).round(),
                              );
                              ref.read(playerProvider.notifier).seek(target);
                            },
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(_fmt(position),
                                    style: TextStyle(
                                        color: AppColors.muted, fontSize: 12)),
                                Text(_fmt(duration),
                                    style: TextStyle(
                                        color: AppColors.muted, fontSize: 12)),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          // Controls
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              IconButton(
                                iconSize: 22,
                                icon: Icon(
                                  Icons.shuffle,
                                  color: shuffle
                                      ? Theme.of(context).colorScheme.primary
                                      : AppColors.muted,
                                ),
                                onPressed: () => ref
                                    .read(playerProvider.notifier)
                                    .toggleShuffle(),
                              ),
                              IconButton(
                                iconSize: 36,
                                icon: Icon(Icons.skip_previous,
                                    color: AppColors.text),
                                onPressed: () => ref
                                    .read(playerProvider.notifier)
                                    .previous(),
                              ),
                              Container(
                                width: 64,
                                height: 64,
                                decoration: BoxDecoration(
                                  color: Theme.of(context).colorScheme.primary,
                                  shape: BoxShape.circle,
                                ),
                                child: IconButton(
                                  iconSize: 34,
                                  icon: Icon(
                                    playing ? Icons.pause : Icons.play_arrow,
                                    color: AppColors.text,
                                  ),
                                  onPressed: () {
                                    final notifier =
                                        ref.read(playerProvider.notifier);
                                    playing
                                        ? notifier.pause()
                                        : notifier.play();
                                  },
                                ),
                              ),
                              IconButton(
                                iconSize: 36,
                                icon: Icon(Icons.skip_next,
                                    color: AppColors.text),
                                onPressed: () =>
                                    ref.read(playerProvider.notifier).next(),
                              ),
                              IconButton(
                                iconSize: 22,
                                icon: Icon(
                                  repeatMode == LoopMode.one
                                      ? Icons.repeat_one
                                      : Icons.repeat,
                                  color: repeatMode != LoopMode.off
                                      ? Theme.of(context).colorScheme.primary
                                      : AppColors.muted,
                                ),
                                onPressed: () => ref
                                    .read(playerProvider.notifier)
                                    .toggleRepeat(),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    const UpNextSection(),
                    AlbumTracksSection(song: song),
                    ArtistTracksSection(song: song),
                    const SizedBox(height: 24),
                  ],
                ),
              ),
            ),
    );

    // The whole screen — app bar included — follows the finger while it is
    // pulled down; the route is transparent (see app.dart), so the screen
    // underneath shows through as it moves.
    return Listener(
      onPointerDown: (e) => _onPointerDown(e, showLyrics),
      onPointerMove: _onPointerMove,
      onPointerUp: _onPointerEnd,
      onPointerCancel: _onPointerEnd,
      child: Transform.translate(
        offset: Offset(0, _dismissDy),
        child: scaffold,
      ),
    );
  }
}

/// Full-size cover art for a single track — used for the currently playing
/// track and for the next/previous track peeking in from the edge while the
/// hero art is being dragged.
class _PlayerCoverArt extends StatelessWidget {
  final Song song;
  final SubsonicClient? client;
  final double size;

  const _PlayerCoverArt({
    required this.song,
    required this.client,
    required this.size,
  });

  @override
  Widget build(BuildContext context) {
    return CoverArt(
      // Full-screen hero image — the most prominent artwork in the app
      // deserves a size closer to what a high-DPI display actually needs,
      // not the ~44px-thumbnail-derived default.
      url: song.coverArt != null
          ? client?.coverArtUrl(song.coverArt!, size: 800)
          : null,
      size: size,
      borderRadius: BorderRadius.circular(12),
    );
  }
}
