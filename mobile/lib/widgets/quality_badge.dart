import 'package:flutter/material.dart';

import '../api/types.dart';
import '../app_colors.dart';
import '../utils/quality.dart';

/// Small format chip ("Hi-Res", "Lossless", "MP3"); nothing when the format is unknown.
class QualityBadge extends StatelessWidget {
  const QualityBadge({super.key, this.song, this.quality})
      : assert(song != null || quality != null);

  /// Either a song, or an already-computed quality (e.g. an album's best).
  final Song? song;
  final AudioQuality? quality;

  @override
  Widget build(BuildContext context) {
    final q = quality ?? audioQuality(song!);
    final label = q.label;
    if (label == null) return const SizedBox.shrink();

    final (Color fill, Color border, Color text) = switch (q.tier) {
      QualityTier.hires => (
          AppColors.brand,
          AppColors.brand,
          AppColors.onBrand
        ),
      QualityTier.lossless => (
          Colors.transparent,
          AppColors.brand,
          AppColors.brand
        ),
      QualityTier.lossy => (
          Colors.transparent,
          AppColors.border,
          AppColors.mutedLight
        ),
      QualityTier.unknown => (
          Colors.transparent,
          AppColors.surface2,
          AppColors.muted
        ),
    };

    return Tooltip(
      message: q.summary,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        decoration: BoxDecoration(
          color: fill,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
              color: text,
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.5),
        ),
      ),
    );
  }
}
