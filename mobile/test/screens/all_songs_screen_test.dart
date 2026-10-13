import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/screens/all_songs_screen.dart';

import '../helpers/mocks.dart';

List<Song> _songs(int from, int count) => [
      for (var i = from; i < from + count; i++)
        Song(
          id: 's$i',
          title: 'Title $i',
          artist: 'Artist',
          artistId: 'ar',
          album: 'Album',
          albumId: 'al',
          suffix: 'mp3',
          duration: 200,
        ),
    ];

void main() {
  setUpAll(registerMockFallbackValues);

  late MockAudioHandler handler;
  late MockSubsonicClient client;

  setUp(() {
    handler = MockAudioHandler();
    client = MockSubsonicClient();
    when(() => handler.positionStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.durationStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.playingStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.currentIndexStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.shuffleModeEnabledStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.loopModeStream).thenAnswer((_) => const Stream.empty());
    when(() => client.getAllSongs(0, 200,
            genre: any(named: 'genre'),
            sort: any(named: 'sort'),
            quality: any(named: 'quality')))
        .thenAnswer((_) async => _songs(0, 200));
    when(() => client.getAllSongs(200, 200,
            genre: any(named: 'genre'),
            sort: any(named: 'sort'),
            quality: any(named: 'quality')))
        .thenAnswer((_) async => _songs(200, 50));
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          playerProvider.overrideWith((ref) => PlayerNotifier(handler)),
          apiClientProvider.overrideWithValue(client),
          downloadServiceProvider.overrideWithValue(MockDownloadService()),
        ],
        child: const MaterialApp(home: AllSongsScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('loads the next page by itself when scrolled near the end',
      (tester) async {
    await pumpScreen(tester);

    expect(find.text('Load more'), findsNothing);
    verifyNever(() => client.getAllSongs(200, 200,
        genre: any(named: 'genre'),
        sort: any(named: 'sort'),
        quality: any(named: 'quality')));

    await tester.drag(find.byType(ListView), const Offset(0, -100000));
    await tester.pumpAndSettle();

    verify(() => client.getAllSongs(200, 200,
        genre: any(named: 'genre'),
        sort: any(named: 'sort'),
        quality: any(named: 'quality'))).called(1);

    await tester.drag(find.byType(ListView), const Offset(0, -100000));
    await tester.pumpAndSettle();
    expect(find.text('Title 249'), findsOneWidget);
  });

  testWidgets('stops requesting pages once a short page comes back',
      (tester) async {
    await pumpScreen(tester);
    for (var i = 0; i < 3; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, -100000));
      await tester.pumpAndSettle();
    }

    verify(() => client.getAllSongs(200, 200,
        genre: any(named: 'genre'),
        sort: any(named: 'sort'),
        quality: any(named: 'quality'))).called(1);
    verifyNever(() => client.getAllSongs(250, 200,
        genre: any(named: 'genre'),
        sort: any(named: 'sort'),
        quality: any(named: 'quality')));
  });
}
