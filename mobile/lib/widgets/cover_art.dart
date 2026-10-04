import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../app_colors.dart';

class CoverArt extends StatelessWidget {
  final String? url;

  /// Fixed square size in logical pixels. Leave null to fill whatever space
  /// the parent gives it (e.g. inside a grid cell's `Expanded`).
  final double? size;
  final BorderRadius? borderRadius;

  /// Shown instead of the generic placeholder when [url] is null or fails to
  /// load — e.g. a branded stock cover for a system view or playlist.
  final Widget? fallback;

  const CoverArt({
    super.key,
    required this.url,
    this.size = 48,
    this.borderRadius,
    this.fallback,
  });

  @override
  Widget build(BuildContext context) {
    final radius = borderRadius ?? BorderRadius.circular(6);

    if (url == null) return fallback ?? _placeholder(radius);

    return ClipRRect(
      borderRadius: radius,
      child: CachedNetworkImage(
        imageUrl: url!,
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (_, __) => _placeholderBox(),
        errorWidget: (_, __, ___) => fallback ?? _placeholderBox(),
      ),
    );
  }

  Widget _placeholder(BorderRadius radius) => ClipRRect(
        borderRadius: radius,
        child: _placeholderBox(),
      );

  Widget _placeholderBox() => Container(
        width: size,
        height: size,
        color: AppColors.surface,
        child: Icon(
          Icons.music_note,
          size: (size ?? 48) * 0.4,
          color: AppColors.border,
        ),
      );
}
