import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../widgets/cover_art.dart';
import '../widgets/stock_covers.dart' as stock;
import '../app_colors.dart';

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

class WrappedScreen extends ConsumerStatefulWidget {
  const WrappedScreen({super.key});

  @override
  ConsumerState<WrappedScreen> createState() => _WrappedScreenState();
}

class _WrappedScreenState extends ConsumerState<WrappedScreen> {
  late int _year;
  bool _generatingSummary = false;
  String? _summary;
  String? _summaryError;

  @override
  void initState() {
    super.initState();
    _year = DateTime.now().year;
  }

  Future<void> _generateSummary() async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    setState(() {
      _generatingSummary = true;
      _summaryError = null;
    });
    try {
      final summary = await client.generateWrappedSummary(year: _year);
      if (mounted) setState(() => _summary = summary);
    } catch (e) {
      if (mounted) {
        setState(
            () => _summaryError = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _generatingSummary = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final statsAsync = ref.watch(wrappedProvider(_year));
    final years = List.generate(5, (i) => DateTime.now().year - i);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Wrapped'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: DropdownButton<int>(
                value: _year,
                underline: const SizedBox(),
                dropdownColor: AppColors.surface,
                items: years
                    .map((y) => DropdownMenuItem(value: y, child: Text('$y')))
                    .toList(),
                onChanged: (y) {
                  if (y != null) {
                    setState(() {
                      _year = y;
                      _summary = null;
                      _summaryError = null;
                    });
                  }
                },
              ),
            ),
          ),
        ],
      ),
      body: statsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text('No play history found for $_year.',
              style: TextStyle(color: AppColors.muted)),
        ),
        data: (stats) {
          if (stats.totalPlays == 0) {
            return Center(
              child: Text('No plays recorded for $_year yet.',
                  style: TextStyle(color: AppColors.muted)),
            );
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(
                  child: stock.WrappedCover(
                      size: 96, borderRadius: BorderRadius.circular(14))),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                      child: _StatCard(
                          label: 'Total plays', value: '${stats.totalPlays}')),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _StatCard(
                      label: 'Listening time',
                      value: '${(stats.totalMinutes / 60).round()} hrs',
                      sub: '${stats.totalMinutes} min',
                    ),
                  ),
                ],
              ),
              if (stats.importedPlays > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                      'Includes ${stats.importedPlays} plays imported from other services.',
                      style: TextStyle(color: AppColors.muted, fontSize: 11.5)),
                ),
              if (stats.topTracks.isNotEmpty) ...[
                const SizedBox(height: 24),
                const _SectionLabel('Top track'),
                const SizedBox(height: 10),
                _TopTrackCard(track: stats.topTracks.first),
              ],
              if (stats.topArtists.isNotEmpty) ...[
                const SizedBox(height: 24),
                const _SectionLabel('Top artists'),
                const SizedBox(height: 10),
                ...stats.topArtists.take(5).toList().asMap().entries.map(
                      (e) => _TopArtistRow(rank: e.key + 1, artist: e.value),
                    ),
              ],
              if (stats.byMonth.isNotEmpty) ...[
                const SizedBox(height: 24),
                const _SectionLabel('Plays by month'),
                const SizedBox(height: 12),
                _MonthChart(byMonth: stats.byMonth),
              ],
              const SizedBox(height: 24),
              const _SectionLabel('AI summary'),
              const SizedBox(height: 10),
              if (_summary != null)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(_summary!,
                      style: TextStyle(color: AppColors.text, height: 1.5)),
                )
              else
                Row(
                  children: [
                    ElevatedButton(
                      onPressed: _generatingSummary ? null : _generateSummary,
                      child: Text(_generatingSummary
                          ? 'Generating…'
                          : 'Generate with Ollama'),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Requires Ollama configured by your server admin.',
                        style:
                            TextStyle(color: AppColors.muted, fontSize: 11.5),
                      ),
                    ),
                  ],
                ),
              if (_summaryError != null) ...[
                const SizedBox(height: 8),
                Text(_summaryError!,
                    style: TextStyle(color: AppColors.danger, fontSize: 12)),
              ],
              if (stats.topTracks.length > 1) ...[
                const SizedBox(height: 24),
                const _SectionLabel('All top tracks'),
                const SizedBox(height: 10),
                ...stats.topTracks.toList().asMap().entries.map(
                      (e) => _TopTrackRow(rank: e.key + 1, track: e.value),
                    ),
              ],
              const SizedBox(height: 40),
            ],
          );
        },
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);
  @override
  Widget build(BuildContext context) => Text(
        text.toUpperCase(),
        style: TextStyle(
          color: AppColors.muted,
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      );
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  const _StatCard({required this.label, required this.value, this.sub});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label.toUpperCase(),
                style: TextStyle(
                    color: AppColors.muted, fontSize: 11, letterSpacing: 1)),
            const SizedBox(height: 6),
            Text(value,
                style: TextStyle(
                    color: AppColors.text,
                    fontSize: 26,
                    fontWeight: FontWeight.bold)),
            if (sub != null)
              Text(sub!,
                  style: TextStyle(color: AppColors.muted, fontSize: 12)),
          ],
        ),
      );
}

class _TopTrackCard extends ConsumerWidget {
  final WrappedTopTrack track;
  const _TopTrackCard({required this.track});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final coverUrl = track.coverArt != null
        ? client?.coverArtUrl(track.coverArt!, size: 200)
        : null;
    return GestureDetector(
      onTap: track.external
          ? null
          : () => context.push('/albums/${track.albumId}'),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            CoverArt(
                url: coverUrl,
                size: 56,
                borderRadius: BorderRadius.circular(8)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(track.title,
                      style: TextStyle(
                          color: AppColors.text,
                          fontWeight: FontWeight.bold,
                          fontSize: 15)),
                  Text(track.artist,
                      style: TextStyle(color: AppColors.muted, fontSize: 13)),
                  Text('${track.playCount} plays',
                      style: TextStyle(color: AppColors.muted, fontSize: 11)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TopArtistRow extends ConsumerWidget {
  final int rank;
  final WrappedTopArtist artist;
  const _TopArtistRow({required this.rank, required this.artist});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final client = ref.read(apiClientProvider);
    final coverUrl = artist.coverArt != null
        ? client?.coverArtUrl(artist.coverArt!, size: 100)
        : null;
    return GestureDetector(
      onTap: artist.external || artist.id.isEmpty
          ? null
          : () => context.push('/artists/${artist.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            SizedBox(
              width: 20,
              child: Text('$rank',
                  textAlign: TextAlign.right,
                  style: TextStyle(color: AppColors.muted, fontSize: 13)),
            ),
            const SizedBox(width: 10),
            CoverArt(
                url: coverUrl,
                size: 36,
                borderRadius: BorderRadius.circular(18)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(artist.name,
                  style: TextStyle(
                      color: AppColors.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w500)),
            ),
            Text('${artist.playCount} plays',
                style: TextStyle(color: AppColors.muted, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

class _TopTrackRow extends StatelessWidget {
  final int rank;
  final WrappedTopTrack track;
  const _TopTrackRow({required this.rank, required this.track});

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: track.external
            ? null
            : () => context.push('/albums/${track.albumId}'),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            children: [
              SizedBox(
                width: 20,
                child: Text('$rank',
                    textAlign: TextAlign.right,
                    style: TextStyle(color: AppColors.muted, fontSize: 13)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(track.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: AppColors.text,
                            fontSize: 13.5,
                            fontWeight: FontWeight.w500)),
                    Text('${track.artist} · ${track.album}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.muted, fontSize: 12)),
                  ],
                ),
              ),
              Text('${track.playCount} plays',
                  style: TextStyle(color: AppColors.muted, fontSize: 11.5)),
            ],
          ),
        ),
      );
}

class _MonthChart extends StatelessWidget {
  final List<WrappedMonth> byMonth;
  const _MonthChart({required this.byMonth});

  @override
  Widget build(BuildContext context) {
    final maxPlays =
        byMonth.map((m) => m.plays).fold(1, (a, b) => a > b ? a : b);
    return SizedBox(
      height: 110,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(12, (i) {
          final month = byMonth.where((m) => m.month == i + 1).toList();
          final plays = month.isNotEmpty ? month.first.plays : 0;
          final heightFrac = plays / maxPlays;
          return Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Container(
                    height: (heightFrac * 80)
                        .clamp(plays > 0 ? 4 : 0, 80)
                        .toDouble(),
                    decoration: BoxDecoration(
                      color: Theme.of(context)
                          .colorScheme
                          .primary
                          .withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(_months[i][0],
                      style: TextStyle(color: AppColors.border, fontSize: 10)),
                ],
              ),
            ),
          );
        }),
      ),
    );
  }
}
