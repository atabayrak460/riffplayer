import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/types.dart';
import '../app_colors.dart';
import '../providers/providers.dart';

/// "Weekly discovery": artists (and a track to try) that are NOT in the library, as names only —
/// never a link or a source. Twin of `web/src/components/WeeklyDiscovery.tsx`.
class WeeklyDiscoveryView extends ConsumerStatefulWidget {
  const WeeklyDiscoveryView({super.key});

  @override
  ConsumerState<WeeklyDiscoveryView> createState() =>
      _WeeklyDiscoveryViewState();
}

class _WeeklyDiscoveryViewState extends ConsumerState<WeeklyDiscoveryView> {
  WeeklyDiscovery? _refreshed;
  bool _refreshing = false;

  Future<void> _refresh() async {
    final client = ref.read(apiClientProvider);
    if (client == null || _refreshing) return;
    setState(() => _refreshing = true);
    try {
      final fresh = await client.refreshWeeklyDiscovery();
      if (mounted) setState(() => _refreshed = fresh);
    } catch (_) {
      // keep showing the current list
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  static Widget _note(String text) => Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text(text,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.muted)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(weeklyDiscoveryProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => _note('Couldn\'t load this week\'s discoveries.'),
      data: (loaded) {
        final data = _refreshed ?? loaded;
        switch (data.status) {
          case WeeklyStatus.notConfigured:
            return _note(
                'Weekly discovery needs a Last.fm API key. An admin can add one in Settings → Admin.');
          case WeeklyStatus.noHistory:
            return _note(
                'Listen to some music first — discoveries are based on what you play.');
          case WeeklyStatus.ok:
            break;
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'New this week — artists you don\'t have yet.',
                    style: TextStyle(color: AppColors.muted, fontSize: 13),
                  ),
                ),
                TextButton.icon(
                  onPressed: _refreshing ? null : _refresh,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: Text(_refreshing ? 'Refreshing…' : 'New picks'),
                ),
              ],
            ),
            if (data.items.isEmpty)
              _note('Nothing new to suggest right now — check back next week.'),
            for (final item in data.items) _ItemTile(item: item),
            const SizedBox(height: 16),
            Text(
              'These are suggestions only — names of music that isn\'t in your library. '
              'RiffPlayer never provides links or sources to get it; finding it is up to you.',
              style: TextStyle(color: AppColors.muted, fontSize: 11.5),
            ),
          ],
        );
      },
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item});
  final DiscoveryItem item;

  @override
  Widget build(BuildContext context) {
    var hue = 0;
    for (final r in item.artist.runes) {
      hue = (hue * 31 + r) % 360;
    }
    final letters = item.artist
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .take(2)
        .map((w) => String.fromCharCode(w.runes.first))
        .join()
        .toUpperCase();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              gradient: LinearGradient(colors: [
                HSLColor.fromAHSL(1, hue.toDouble(), 0.55, 0.38).toColor(),
                HSLColor.fromAHSL(1, ((hue + 50) % 360).toDouble(), 0.6, 0.22)
                    .toColor(),
              ]),
            ),
            child: Text(letters.isEmpty ? '♪' : letters,
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.artist,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: AppColors.text,
                        fontWeight: FontWeight.w600,
                        fontSize: 15)),
                if (item.track != null)
                  Text('Try: ${item.track}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color: AppColors.textSecondary, fontSize: 13)),
                if (item.because.isNotEmpty)
                  Text('Because you listen to ${item.because.join(', ')}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: AppColors.muted, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
