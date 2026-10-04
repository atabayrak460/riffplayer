import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/types.dart';
import '../app_colors.dart';
import '../providers/providers.dart';
import '../utils/quality.dart';
import 'quality_badge.dart';

String _fmtDuration(int? seconds) {
  if (seconds == null) return '—';
  final m = seconds ~/ 60;
  final s = seconds % 60;
  return '$m:${s.toString().padLeft(2, '0')}';
}

String _kHzText(int hz) {
  final v = (hz / 1000).toStringAsFixed(1);
  return '${v.endsWith('.0') ? v.substring(0, v.length - 2) : v} kHz';
}

class SongInfoDialog extends ConsumerWidget {
  final Song song;
  const SongInfoDialog({super.key, required this.song});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(meProvider).valueOrNull?.preferences;
    final quality = audioQuality(song);
    final credits =
        ref.watch(trackCreditsProvider(song.id)).valueOrNull ?? const [];
    final rows = <(String, String)>[
      ('Title', song.title),
      ('Artist', song.artist),
      ('Album', song.album),
      ('Duration', _fmtDuration(song.duration)),
      ('Format', song.suffix.toUpperCase()),
      if (song.samplingRate != null)
        ('Sample rate', _kHzText(song.samplingRate!)),
      if (song.bitDepth != null) ('Bit depth', '${song.bitDepth}-bit'),
      if (song.bitRate != null) ('Bitrate', '${song.bitRate} kbps'),
      if (song.playCount != null) ('Play count', '${song.playCount}'),
    ];

    return AlertDialog(
      title: const Text('Song info'),
      content: SingleChildScrollView(
          child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ...rows.map((r) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(r.$1,
                        style: TextStyle(color: AppColors.muted, fontSize: 13)),
                    Flexible(
                      child: Text(
                        r.$2,
                        textAlign: TextAlign.right,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.text, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              )),
          if (credits.isNotEmpty) ...[
            const Divider(height: 24),
            Align(
              alignment: Alignment.centerLeft,
              child: Text('CREDITS',
                  style: TextStyle(
                      color: AppColors.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1)),
            ),
            for (final (label, value) in credits)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(label,
                        style: TextStyle(color: AppColors.muted, fontSize: 13)),
                    const SizedBox(width: 12),
                    Flexible(
                      child: Text(value,
                          textAlign: TextAlign.right,
                          style:
                              TextStyle(color: AppColors.text, fontSize: 13)),
                    ),
                  ],
                ),
              ),
          ],
          if (quality.label != null) ...[
            const Divider(height: 24),
            Row(children: [
              Text('SIGNAL PATH',
                  style: TextStyle(
                      color: AppColors.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1)),
              const SizedBox(width: 8),
              QualityBadge(song: song),
            ]),
            for (final step in signalPath(song, prefs))
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text.rich(TextSpan(children: [
                    TextSpan(
                        text: '${step.stage}: ',
                        style: TextStyle(color: AppColors.muted, fontSize: 13)),
                    TextSpan(
                        text: step.text,
                        style: TextStyle(
                            color: step.degraded
                                ? AppColors.warning
                                : AppColors.text,
                            fontSize: 13)),
                  ])),
                ),
              ),
          ],
        ],
      )),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    );
  }
}
