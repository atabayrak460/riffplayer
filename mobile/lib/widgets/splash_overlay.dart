import 'package:flutter/material.dart';

import '../app_colors.dart';

/// Short logo intro laid over the app on a cold start: the cat mark pops in,
/// two sound-wave rings ripple out behind it, then the overlay fades away.
/// It is only an overlay — the app and its session restore keep loading
/// underneath, so it never delays anything — and a tap skips it.
class SplashOverlay extends StatefulWidget {
  const SplashOverlay({super.key, required this.child});

  final Widget child;

  /// Plays once per process; a rebuilt app widget (hot reload, theme change)
  /// must not replay it. Tests reset it.
  @visibleForTesting
  static bool played = false;

  @override
  State<SplashOverlay> createState() => _SplashOverlayState();
}

class _SplashOverlayState extends State<SplashOverlay>
    with SingleTickerProviderStateMixin {
  static const _showMs = 1300;
  static const _fadeMs = 400;

  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: _showMs + _fadeMs),
  );
  bool _done = SplashOverlay.played;
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started || _done) return;
    // Respect the system "remove animations" setting.
    if (MediaQuery.of(context).disableAnimations) {
      _done = true;
      SplashOverlay.played = true;
      return;
    }
    _started = true;
    SplashOverlay.played = true;
    // A status listener rather than the forward() future: skipping restarts
    // the animation, which cancels the first future.
    _c.addStatusListener((status) {
      if (status == AnimationStatus.completed && mounted) {
        setState(() => _done = true);
      }
    });
    _c.forward();
  }

  void _skip() {
    const fadeStart = _showMs / (_showMs + _fadeMs);
    // `forward(from:)`, not `value =`: assigning value stops the running
    // animation, which would leave the overlay up forever.
    if (_c.value < fadeStart) _c.forward(from: fadeStart);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_done) return widget.child;
    return Stack(
      textDirection: TextDirection.ltr,
      children: [
        widget.child,
        Positioned.fill(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _skip,
            child: AnimatedBuilder(
              animation: _c,
              builder: (_, __) => _frame(_c.value * (_showMs + _fadeMs)),
            ),
          ),
        ),
      ],
    );
  }

  Widget _frame(double ms) {
    final accent = Theme.of(context).colorScheme.primary;
    double ease(double t) => Curves.easeOutCubic.transform(t.clamp(0.0, 1.0));

    // Logo: 0–700 ms pop-in (slight overshoot), like the web intro.
    final pop = ease(ms / 700);
    final scale = 0.82 +
        0.18 * pop +
        0.04 * (1 - (pop - 0.45).abs() * 2).clamp(0.0, 1.0) * 0.5;
    final fade = ms <= _showMs ? 1.0 : 1 - ease((ms - _showMs) / _fadeMs);

    Widget ring(double startMs) {
      final t = ((ms - startMs) / 1200).clamp(0.0, 1.0);
      return Opacity(
        opacity: 0.55 * (1 - t),
        child: Transform.scale(
          scale: 0.5 + 1.6 * ease(t),
          child: Container(
            width: 160,
            height: 160,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: accent, width: 2),
            ),
          ),
        ),
      );
    }

    return Opacity(
      opacity: fade,
      child: ColoredBox(
        color: AppColors.background,
        child: Center(
          child: Stack(
            alignment: Alignment.center,
            children: [
              ring(200),
              ring(550),
              Opacity(
                opacity: pop,
                child: Transform.scale(
                  scale: scale,
                  child: ColorFiltered(
                    colorFilter: ColorFilter.mode(accent, BlendMode.srcIn),
                    child: Image.asset(
                      'assets/images/logo_mark.png',
                      width: 160,
                      excludeFromSemantics: true,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
