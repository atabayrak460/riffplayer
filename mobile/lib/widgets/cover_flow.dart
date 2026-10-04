import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../api/types.dart';
import '../app_colors.dart';

/// Fraction of a full turn-away (0 = facing front, 1 = fully turned) for a
/// cover [offset] pages from the centre, clamped so far covers stop turning.
@visibleForTesting
double coverFlowTurn(double offset) => offset.clamp(-1.0, 1.0);

/// iPod-style Cover Flow: a swipeable row where the centred cover faces front
/// and the others fan away at an angle, with a reflection below each.
class CoverFlow extends StatefulWidget {
  const CoverFlow({
    super.key,
    required this.albums,
    required this.coverUrl,
    required this.onOpen,
    required this.onPlay,
  });

  final List<Album> albums;

  /// Cover image URL for an album at roughly the given size, or null if it has none.
  final String? Function(Album album, int size) coverUrl;
  final void Function(Album album) onOpen;
  final void Function(Album album) onPlay;

  @override
  State<CoverFlow> createState() => _CoverFlowState();
}

class _CoverFlowState extends State<CoverFlow> {
  late final PageController _controller = PageController(viewportFraction: 0.5);
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _goTo(int i) => _controller.animateToPage(
        i,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
      );

  @override
  Widget build(BuildContext context) {
    final albums = widget.albums;
    if (albums.isEmpty) return const SizedBox.shrink();
    final current = albums[_index.clamp(0, albums.length - 1)];

    return Column(
      children: [
        Expanded(
          child: DecoratedBox(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xFF000000), Color(0xFF303030)],
              ),
            ),
            child: PageView.builder(
              controller: _controller,
              itemCount: albums.length,
              onPageChanged: (i) => setState(() => _index = i),
              itemBuilder: (context, i) => _FlowItem(
                album: albums[i],
                index: i,
                controller: _controller,
                initialPage: _index,
                url: widget.coverUrl(albums[i], 400),
                onTap: () => i == _index ? widget.onOpen(albums[i]) : _goTo(i),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 4),
          child: Column(
            children: [
              Text(current.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      color: AppColors.text,
                      fontSize: 17,
                      fontWeight: FontWeight.bold)),
              Text(current.artist,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: AppColors.muted, fontSize: 13)),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Row(
            children: [
              Expanded(
                child: Slider(
                  value: _index.toDouble(),
                  min: 0,
                  max: math.max(1, albums.length - 1).toDouble(),
                  onChanged: albums.length < 2
                      ? null
                      : (v) => _controller.jumpToPage(v.round()),
                ),
              ),
              FilledButton(
                onPressed: () => widget.onPlay(current),
                child: const Text('Play'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _FlowItem extends StatelessWidget {
  const _FlowItem({
    required this.album,
    required this.index,
    required this.controller,
    required this.initialPage,
    required this.url,
    required this.onTap,
  });

  final Album album;
  final int index;
  final PageController controller;
  final int initialPage;
  final String? url;
  final VoidCallback onTap;

  Widget _image() => url == null
      ? Container(
          color: AppColors.surface,
          child: Icon(Icons.music_note, color: AppColors.border, size: 48),
        )
      : CachedNetworkImage(
          imageUrl: url!,
          fit: BoxFit.cover,
          placeholder: (_, __) => Container(color: AppColors.surface),
          errorWidget: (_, __, ___) => Container(
            color: AppColors.surface,
            child: Icon(Icons.music_note, color: AppColors.border, size: 48),
          ),
        );

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final page = controller.hasClients && controller.page != null
            ? controller.page!
            : initialPage.toDouble();
        final offset = index - page; // < 0: left of centre, > 0: right
        final turn = coverFlowTurn(offset);
        final scale = 1 - 0.22 * turn.abs();

        return GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: Center(
            child: LayoutBuilder(builder: (context, c) {
              // A page is half the screen wide, so this is ~55% of the screen width.
              final size = math.min(c.maxWidth * 1.1, c.maxHeight * 0.62);
              return Transform(
                alignment: Alignment.center,
                transform: Matrix4.identity()
                  ..setEntry(3, 2, 0.0012) // perspective
                  ..translateByDouble(
                      -offset.clamp(-1.0, 1.0) * size * 0.18, 0.0, 0.0, 1.0)
                  ..rotateY(-turn * 1.0)
                  ..scaleByDouble(scale, scale, 1.0, 1.0),
                child: SizedBox(
                  width: size,
                  height: size * 1.55,
                  child: Column(
                    children: [
                      SizedBox(width: size, height: size, child: _image()),
                      // Reflection: the cover flipped and faded out.
                      SizedBox(
                        width: size,
                        height: size * 0.5,
                        child: ClipRect(
                          child: ShaderMask(
                            blendMode: BlendMode.dstIn,
                            shaderCallback: (r) => const LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [Color(0x55FFFFFF), Color(0x00FFFFFF)],
                            ).createShader(r),
                            child: Transform.flip(
                              flipY: true,
                              child: Align(
                                alignment: Alignment.bottomCenter,
                                heightFactor: 0.5,
                                child: SizedBox(
                                    width: size, height: size, child: _image()),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          ),
        );
      },
    );
  }
}
