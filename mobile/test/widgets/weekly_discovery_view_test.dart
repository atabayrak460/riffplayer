import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/widgets/weekly_discovery_view.dart';

import '../helpers/mocks.dart';

WeeklyDiscovery _ok(List<DiscoveryItem> items) =>
    WeeklyDiscovery(WeeklyStatus.ok, week: '2026-10-05', items: items);

Future<MockSubsonicClient> _pump(
    WidgetTester tester, WeeklyDiscovery Function() loader) async {
  tester.view.physicalSize = const Size(420, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final client = MockSubsonicClient();
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(client),
      weeklyDiscoveryProvider.overrideWith((ref) async => loader()),
    ],
    child: const MaterialApp(home: Scaffold(body: WeeklyDiscoveryView())),
  ));
  await tester.pumpAndSettle();
  return client;
}

void main() {
  group('WeeklyDiscovery.fromJson', () {
    test('parses a list with names only', () {
      final w = WeeklyDiscovery.fromJson({
        'status': 'ok',
        'week': '2026-10-05',
        'items': [
          {
            'artist': 'Brand New Band',
            'track': 'Hit One',
            'because': ['Radiohead', 'Muse']
          },
          {'artist': 'Another Act', 'because': <String>[]},
        ],
      });
      expect(w.status, WeeklyStatus.ok);
      expect(w.items.first.track, 'Hit One');
      expect(w.items.first.because, ['Radiohead', 'Muse']);
      expect(w.items.last.track, isNull);
    });

    test('understands the "not configured" and "no history" states', () {
      expect(WeeklyDiscovery.fromJson({'status': 'not_configured'}).status,
          WeeklyStatus.notConfigured);
      expect(WeeklyDiscovery.fromJson({'status': 'no_history'}).status,
          WeeklyStatus.noHistory);
    });
  });

  testWidgets('lists suggestions with a track to try and why', (tester) async {
    await _pump(
        tester,
        () => _ok(const [
              DiscoveryItem(
                  artist: 'Brand New Band',
                  track: 'Hit One',
                  because: ['Radiohead']),
            ]));
    expect(find.text('Brand New Band'), findsOneWidget);
    expect(find.text('Try: Hit One'), findsOneWidget);
    expect(find.text('Because you listen to Radiohead'), findsOneWidget);
    expect(find.textContaining('never provides links'), findsOneWidget);
  });

  testWidgets('explains a missing Last.fm key', (tester) async {
    await _pump(
        tester, () => const WeeklyDiscovery(WeeklyStatus.notConfigured));
    expect(find.textContaining('Last.fm API key'), findsOneWidget);
  });

  testWidgets('explains a missing listening history', (tester) async {
    await _pump(tester, () => const WeeklyDiscovery(WeeklyStatus.noHistory));
    expect(find.textContaining('Listen to some music first'), findsOneWidget);
  });

  testWidgets('"New picks" asks the server for a fresh list and shows it',
      (tester) async {
    final client = await _pump(
        tester,
        () => _ok(const [
              DiscoveryItem(artist: 'First', because: ['A'])
            ]));
    when(() => client.refreshWeeklyDiscovery())
        .thenAnswer((_) async => _ok(const [
              DiscoveryItem(artist: 'Second', because: ['A'])
            ]));

    await tester.tap(find.text('New picks'));
    await tester.pumpAndSettle();

    expect(find.text('Second'), findsOneWidget);
    expect(find.text('First'), findsNothing);
  });

  testWidgets('a failed refresh keeps the current list', (tester) async {
    final client = await _pump(
        tester,
        () => _ok(const [
              DiscoveryItem(artist: 'First', because: ['A'])
            ]));
    when(() => client.refreshWeeklyDiscovery()).thenThrow(Exception('offline'));
    await tester.tap(find.text('New picks'));
    await tester.pumpAndSettle();
    expect(find.text('First'), findsOneWidget);
  });
}
