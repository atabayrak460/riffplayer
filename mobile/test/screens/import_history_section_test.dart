import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/screens/settings_screen.dart';

import '../helpers/mocks.dart';

Future<MockSubsonicClient> _pump(
  WidgetTester tester, {
  List<ImportedSource> sources = const [],
  Future<String?> Function()? pickFile,
}) async {
  tester.view.physicalSize = const Size(420, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final client = MockSubsonicClient();
  when(() => client.getImportedHistory()).thenAnswer((_) async => sources);
  await tester.pumpWidget(ProviderScope(
    overrides: [apiClientProvider.overrideWithValue(client)],
    child: MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
            child: ImportHistorySection(pickFile: pickFile)),
      ),
    ),
  ));
  await tester.pump();
  return client;
}

void main() {
  testWidgets('uploads the chosen export and says what was added',
      (tester) async {
    final client =
        await _pump(tester, pickFile: () async => '/tmp/spotify.zip');
    when(() => client.importHistoryFile(any())).thenAnswer((_) async =>
        const ImportOutcome(source: 'spotify', added: 8, duplicates: 2));

    await tester.tap(find.text('Choose Spotify / Apple Music export'));
    await tester.pump();
    await tester.pump();

    verify(() => client.importHistoryFile('/tmp/spotify.zip')).called(1);
    expect(find.text('8 plays added from Spotify, 2 already counted.'),
        findsOneWidget);
  });

  testWidgets('does nothing when no file is chosen', (tester) async {
    final client = await _pump(tester, pickFile: () async => null);
    await tester.tap(find.text('Choose Spotify / Apple Music export'));
    await tester.pump();
    verifyNever(() => client.importHistoryFile(any()));
  });

  testWidgets('imports a Last.fm profile for the chosen year', (tester) async {
    final client = await _pump(tester);
    when(() => client.importLastFm(any(), any())).thenAnswer((_) async =>
        const ImportOutcome(source: 'lastfm', added: 5, duplicates: 0));

    await tester.enterText(find.byType(TextField), ' someone ');
    await tester.tap(find.text('Import'));
    await tester.pump();
    await tester.pump();

    verify(() => client.importLastFm('someone', DateTime.now().year)).called(1);
    expect(find.text('5 plays added from Last.fm.'), findsOneWidget);
  });

  testWidgets('lists what was imported and removes a source', (tester) async {
    final client = await _pump(tester, sources: const [
      ImportedSource(source: 'apple_music', plays: 1200, matched: 300),
    ]);
    when(() => client.removeImportedHistory(any())).thenAnswer((_) async {});

    expect(find.text('Apple Music'), findsOneWidget);
    expect(find.text('1200 plays · 300 in your library'), findsOneWidget);
    await tester.tap(find.text('Remove'));
    await tester.pump();
    verify(() => client.removeImportedHistory('apple_music')).called(1);
  });
}
