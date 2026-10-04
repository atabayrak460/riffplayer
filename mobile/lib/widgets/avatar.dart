import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/providers.dart';

/// A member's picture, or their initial on a colour tile when they have none.
class Avatar extends ConsumerWidget {
  const Avatar({
    super.key,
    required this.userId,
    required this.name,
    required this.hasAvatar,
    this.version,
    this.size = 48,
  });

  final int userId;
  final String name;
  final bool hasAvatar;
  final int? version;
  final double size;

  Widget _initial() {
    var hue = 0;
    for (final r in name.runes) {
      hue = (hue * 31 + r) % 360;
    }
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(colors: [
          HSLColor.fromAHSL(1, hue.toDouble(), 0.55, 0.38).toColor(),
          HSLColor.fromAHSL(1, ((hue + 50) % 360).toDouble(), 0.6, 0.22)
              .toColor(),
        ]),
      ),
      child: Text(
        name.isEmpty
            ? '?'
            : String.fromCharCode(name.runes.first).toUpperCase(),
        style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: size * 0.42),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    if (!hasAvatar || client == null) return _initial();
    return ClipOval(
      child: CachedNetworkImage(
        imageUrl: client.avatarUrl(userId, version),
        // The auth parameters change on every call; the picture itself only changes with its version.
        cacheKey: 'avatar-$userId-${version ?? 0}',
        width: size,
        height: size,
        fit: BoxFit.cover,
        placeholder: (_, __) => _initial(),
        errorWidget: (_, __, ___) => _initial(),
      ),
    );
  }
}
