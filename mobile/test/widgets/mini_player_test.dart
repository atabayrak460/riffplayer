import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/widgets/mini_player.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import '../helpers/mocks.dart';

Song _song(String id) => Song(
      id: id,
      title: 'Title $id',
      artist: 'Artist $id',
      artistId: 'artist-1',
      album: 'Album',
      albumId: 'album-1',
      suffix: 'mp3',
      duration: 200,
    );

void main() {
  setUpAll(registerMockFallbackValues);

  late MockAudioHandler handler;
  late MockSubsonicClient client;
  late MockDownloadService downloads;

  setUp(() {
    handler = MockAudioHandler();
    client = MockSubsonicClient();
    downloads = MockDownloadService();

    when(() => handler.positionStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.durationStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.playingStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.currentIndexStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.shuffleModeEnabledStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.loopModeStream).thenAnswer((_) => const Stream.empty());

    when(() => handler.insertAt(any(), any())).thenAnswer((_) async {});
    when(() => handler.playQueue(any(), any())).thenAnswer((_) async {});
    when(() => handler.skipToNext()).thenAnswer((_) async {});
    when(() => handler.skipToPrevious()).thenAnswer((_) async {});
    when(() => handler.play()).thenAnswer((_) async {});
    when(() => handler.pause()).thenAnswer((_) async {});
    when(() => downloads.localPath(any())).thenAnswer((_) async => null);
    when(() => client.streamUrl(any())).thenReturn('http://test/stream');
    when(() => client.scrobble(any(), submission: any(named: 'submission')))
        .thenAnswer((_) async {});
  });

  // MiniPlayer's GestureDetector always has an onTap (navigate to /player)
  // alongside the horizontal-drag handlers — a drag too short to be claimed
  // by the pan recognizer still resolves as a tap, so every test needs a
  // real GoRouter in context, not just the one that explicitly checks
  // navigation.
  Future<PlayerNotifier> pumpMiniPlayer(
    WidgetTester tester, {
    Song? nowPlaying,
  }) async {
    final notifier = PlayerNotifier(handler);
    if (nowPlaying != null) {
      await notifier.playSong(nowPlaying, client, downloads);
    }

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
            path: '/', builder: (_, __) => const Scaffold(body: MiniPlayer())),
        GoRoute(
          path: '/player',
          builder: (_, __) => const Scaffold(body: Text('Now Playing Screen')),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          playerProvider.overrideWith((ref) => notifier),
          apiClientProvider.overrideWithValue(client),
          downloadServiceProvider.overrideWithValue(downloads),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pump();
    return notifier;
  }

  testWidgets('renders nothing when nothing is playing', (tester) async {
    await pumpMiniPlayer(tester);
    expect(find.byType(MiniPlayer), findsOneWidget);
    expect(find.text('Title a'), findsNothing);
  });

  testWidgets('shows the current song title and artist', (tester) async {
    await pumpMiniPlayer(tester, nowPlaying: _song('a'));

    expect(find.text('Title a'), findsOneWidget);
    expect(find.text('Artist a'), findsOneWidget);
  });

  testWidgets('tapping the mini player navigates to /player', (tester) async {
    await pumpMiniPlayer(tester, nowPlaying: _song('a'));

    await tester.tap(find.byType(MiniPlayer));
    await tester.pumpAndSettle();

    expect(find.text('Now Playing Screen'), findsOneWidget);
  });

  testWidgets('flicking the mini player upward opens /player', (tester) async {
    await pumpMiniPlayer(tester, nowPlaying: _song('a'));

    await tester.fling(find.byType(MiniPlayer), const Offset(0, -150), 1000);
    await tester.pumpAndSettle();

    expect(find.text('Now Playing Screen'), findsOneWidget);
  });

  testWidgets('a slow upward drag does not open the player', (tester) async {
    await pumpMiniPlayer(tester, nowPlaying: _song('a'));

    await tester.fling(find.byType(MiniPlayer), const Offset(0, -40), 50);
    await tester.pumpAndSettle();

    expect(find.text('Now Playing Screen'), findsNothing);
  });

  group('transport buttons', () {
    testWidgets('play button calls play() when paused', (tester) async {
      await pumpMiniPlayer(tester, nowPlaying: _song('a'));

      await tester.tap(find.byIcon(Icons.play_arrow));
      await tester.pump();

      verify(() => handler.play()).called(1);
    });

    testWidgets('previous/next buttons delegate to the handler',
        (tester) async {
      await pumpMiniPlayer(tester, nowPlaying: _song('a'));

      await tester.tap(find.byIcon(Icons.skip_previous));
      await tester.tap(find.byIcon(Icons.skip_next));
      await tester.pump();

      verify(() => handler.skipToPrevious()).called(1);
      verify(() => handler.skipToNext()).called(1);
    });
  });

  group('swipe to skip', () {
    testWidgets('swiping left far enough skips to the next track',
        (tester) async {
      await pumpMiniPlayer(tester, nowPlaying: _song('a'));

      await tester.timedDrag(
        find.byType(MiniPlayer),
        const Offset(-200, 0),
        const Duration(milliseconds: 300),
      );
      await tester.pumpAndSettle();

      verify(() => handler.skipToNext()).called(1);
      verifyNever(() => handler.skipToPrevious());
    });

    testWidgets('swiping right far enough skips to the previous track',
        (tester) async {
      await pumpMiniPlayer(tester, nowPlaying: _song('a'));

      await tester.timedDrag(
        find.byType(MiniPlayer),
        const Offset(200, 0),
        const Duration(milliseconds: 300),
      );
      await tester.pumpAndSettle();

      verify(() => handler.skipToPrevious()).called(1);
      verifyNever(() => handler.skipToNext());
    });

    testWidgets('a short swipe below the threshold does not skip',
        (tester) async {
      await pumpMiniPlayer(tester, nowPlaying: _song('a'));

      await tester.timedDrag(
        find.byType(MiniPlayer),
        const Offset(-15, 0),
        const Duration(milliseconds: 300),
      );
      await tester.pumpAndSettle();

      verifyNever(() => handler.skipToNext());
      verifyNever(() => handler.skipToPrevious());
    });
  });
}
