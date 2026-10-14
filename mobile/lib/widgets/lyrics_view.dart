import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../app_colors.dart';

/// Scrollable lyrics list shown in place of the cover art on the full-screen
/// player. Highlights and auto-scrolls to the current line for synced
/// lyrics; renders plain (unhighlighted) text for unsynced ones — same
/// distinction the web client's LyricsPanel makes.
class LyricsView extends ConsumerStatefulWidget {
  final String songId;
  final Duration position;
  final double size;

  const LyricsView({
    super.key,
    required this.songId,
    required this.position,
    required this.size,
  });

  @override
  ConsumerState<LyricsView> createState() => _LyricsViewState();
}

class _LyricsViewState extends ConsumerState<LyricsView> {
  // A line is at least this tall (so short and blank lines keep their
  // spacing) and grows to as many rows as it needs: a long line wraps instead
  // of being cut off.
  static const _minLineHeight = 44.0;
  final _scrollController = ScrollController();
  final _lineKeys = <int, GlobalKey>{};
  int _lastActiveIndex = -1;

  @override
  void didUpdateWidget(LyricsView old) {
    super.didUpdateWidget(old);
    if (old.songId != widget.songId) {
      _lastActiveIndex = -1;
      _lineKeys.clear();
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  GlobalKey _keyFor(int i) => _lineKeys.putIfAbsent(i, GlobalKey.new);

  // Lines differ in height now, so the active one is centred by asking its
  // own render box rather than by multiplying an index by a fixed height.
  void _scrollToActive(int index) {
    final context = _lineKeys[index]?.currentContext;
    if (context == null || !_scrollController.hasClients) return;
    Scrollable.ensureVisible(
      context,
      alignment: 0.5,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  Widget _line(Lyrics lyrics, int i, bool isActive) {
    final line = lyrics.line[i];
    final text = line.value;
    // Synced lines jump playback to their timestamp on tap.
    return GestureDetector(
      key: ValueKey('lyric-line-$i'),
      behavior: HitTestBehavior.opaque,
      onTap: lyrics.synced
          ? () => ref
              .read(playerProvider.notifier)
              .seek(Duration(milliseconds: line.start))
          : null,
      child: KeyedSubtree(
        key: _keyFor(i),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: _minLineHeight),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Text(
                text.isEmpty ? ' ' : text,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: isActive ? AppColors.text : AppColors.muted,
                  fontSize: isActive ? 17 : 14,
                  fontWeight: isActive ? FontWeight.w700 : FontWeight.normal,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lyricsAsync = ref.watch(lyricsProvider(widget.songId));

    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: lyricsAsync.when(
        loading: () => Center(
          child:
              Text('Loading lyrics…', style: TextStyle(color: AppColors.muted)),
        ),
        error: (_, __) => Center(
          child: Text('Lyrics unavailable.',
              style: TextStyle(color: AppColors.muted)),
        ),
        data: (lyrics) {
          if (lyrics == null || lyrics.line.isEmpty) {
            return Center(
              child: Text('No lyrics found for this track.',
                  style: TextStyle(color: AppColors.muted)),
            );
          }

          var activeIndex = -1;
          if (lyrics.synced) {
            final posMs = widget.position.inMilliseconds;
            for (var i = 0; i < lyrics.line.length; i++) {
              if (lyrics.line[i].start <= posMs) {
                activeIndex = i;
              } else {
                break;
              }
            }
          }

          if (activeIndex != _lastActiveIndex && activeIndex >= 0) {
            _lastActiveIndex = activeIndex;
            final target = activeIndex;
            WidgetsBinding.instance
                .addPostFrameCallback((_) => _scrollToActive(target));
          }

          // A plain scroll view rather than a lazy list: lyrics are a few dozen
          // lines, and every line has to exist for its height to be known.
          return SingleChildScrollView(
            controller: _scrollController,
            child: Column(
              children: [
                for (var i = 0; i < lyrics.line.length; i++)
                  _line(lyrics, i, i == activeIndex),
              ],
            ),
          );
        },
      ),
    );
  }
}
