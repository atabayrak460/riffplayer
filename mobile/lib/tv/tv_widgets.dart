import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/types.dart';
import '../app_colors.dart';
import '../providers/providers.dart';

/// Everything on the TV is reached with a remote: arrow keys move the focus, Select / Enter activates.
/// This gives any child a clearly visible focus ring and an activate action.
class TvFocusable extends StatefulWidget {
  const TvFocusable({
    super.key,
    required this.child,
    required this.onActivate,
    this.autofocus = false,
    this.borderRadius = 12,
    this.focusNode,
    this.onFocusChange,
  });

  final Widget child;
  final VoidCallback onActivate;
  final bool autofocus;
  final double borderRadius;
  final FocusNode? focusNode;
  final ValueChanged<bool>? onFocusChange;

  @override
  State<TvFocusable> createState() => _TvFocusableState();
}

class _TvFocusableState extends State<TvFocusable> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    return FocusableActionDetector(
      autofocus: widget.autofocus,
      focusNode: widget.focusNode,
      onShowFocusHighlight: (v) {
        setState(() => _focused = v);
        widget.onFocusChange?.call(v);
        // Keep the focused item on screen as the remote moves through a long list.
        if (v) {
          Scrollable.ensureVisible(context,
              alignment: 0.5, duration: const Duration(milliseconds: 150));
        }
      },
      actions: {
        ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
          widget.onActivate();
          return null;
        }),
      },
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.select): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.numpadEnter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.gameButtonA): ActivateIntent(),
      },
      child: GestureDetector(
        onTap: widget.onActivate,
        child: AnimatedScale(
          scale: _focused ? 1.05 : 1.0,
          duration: const Duration(milliseconds: 120),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(widget.borderRadius),
              border: Border.all(
                color: _focused ? AppColors.brand : Colors.transparent,
                width: 3,
              ),
            ),
            child: widget.child,
          ),
        ),
      ),
    );
  }
}

/// A cover with a title (and subtitle) beneath it — an album, artist or playlist.
class TvCard extends ConsumerWidget {
  const TvCard({
    super.key,
    required this.title,
    this.subtitle,
    this.coverArt,
    required this.onActivate,
    this.autofocus = false,
    this.width = 190,
    this.round = false,
  });

  final String title;
  final String? subtitle;
  final String? coverArt;
  final VoidCallback onActivate;
  final bool autofocus;
  final double width;
  final bool round;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final url =
        coverArt != null ? client?.coverArtUrl(coverArt!, size: 400) : null;
    return SizedBox(
      width: width,
      child: TvFocusable(
        autofocus: autofocus,
        onActivate: onActivate,
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(round ? width : 8),
                child: SizedBox(
                  width: width - 12,
                  height: width - 12,
                  child: url == null
                      ? Container(
                          color: AppColors.surface,
                          child: Icon(Icons.music_note,
                              color: AppColors.border, size: 48))
                      : Image.network(url,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) =>
                              Container(color: AppColors.surface)),
                ),
              ),
              const SizedBox(height: 8),
              Text(title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: AppColors.text,
                      fontSize: 18,
                      fontWeight: FontWeight.w600)),
              if (subtitle != null)
                Text(subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: AppColors.muted, fontSize: 15)),
            ],
          ),
        ),
      ),
    );
  }
}

/// A heading with a horizontally scrolling row of cards beneath it.
class TvRow extends StatelessWidget {
  const TvRow({super.key, required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(32, 24, 32, 8),
          child: Text(title,
              style: TextStyle(
                  color: AppColors.text,
                  fontSize: 24,
                  fontWeight: FontWeight.bold)),
        ),
        SizedBox(
          height: 270,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 26),
            itemCount: children.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) => children[i],
          ),
        ),
      ],
    );
  }
}

/// A grid of cards for the Albums / Artists / Playlists pages.
class TvGrid extends StatelessWidget {
  const TvGrid({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => GridView.builder(
        padding: const EdgeInsets.all(32),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisExtent: 270,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
        ),
        itemCount: children.length,
        itemBuilder: (_, i) => children[i],
      );
}

/// Starts [songs] from [index] on this TV.
void tvPlay(WidgetRef ref, List<Song> songs, [int index = 0]) {
  final client = ref.read(apiClientProvider);
  if (client == null || songs.isEmpty) return;
  ref.read(playerProvider.notifier).playSong(
        songs[index],
        client,
        ref.read(downloadServiceProvider),
        queue: songs,
        queueIndex: index,
      );
}

/// Loading / error / empty states shared by the TV pages.
class TvMessage extends StatelessWidget {
  const TvMessage(this.text, {super.key, this.loading = false});
  final String text;
  final bool loading;

  @override
  Widget build(BuildContext context) => Center(
        child: loading
            ? const CircularProgressIndicator()
            : Text(text,
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 22)),
      );
}

String tvFormatDuration(Duration d) {
  final m = d.inMinutes.remainder(60).toString();
  final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
  return d.inHours > 0 ? '${d.inHours}:${m.padLeft(2, '0')}:$s' : '$m:$s';
}
