import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/app_colors.dart';
import 'package:riffplayer_mobile/providers/theme_provider.dart';
import 'package:riffplayer_mobile/theme.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/screens/player_screen.dart';
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
    when(() => handler.playQueue(any(), any())).thenAnswer((_) async {});
    when(() => handler.skipToNext()).thenAnswer((_) async {});
    when(() => handler.skipToPrevious()).thenAnswer((_) async {});
    when(() => downloads.localPath(any())).thenAnswer((_) async => null);
    when(() => client.streamUrl(any())).thenReturn('http://test/stream');
    when(() => client.coverArtUrl(any(), size: any(named: 'size')))
        .thenReturn('http://test/cover');
    when(() => client.scrobble(any(), submission: any(named: 'submission')))
        .thenAnswer((_) async {});
  });

  Future<void> pumpPlayer(WidgetTester tester,
      {AppSkin skin = AppSkin.standard}) async {
    // Phone-sized: on the default 800x600 surface the title is below the fold.
    tester.view.physicalSize = const Size(400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final notifier = PlayerNotifier(handler);
    await notifier.playSong(_song('a'), client, downloads);

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, __) => Scaffold(
            body: TextButton(
              onPressed: () => context.push('/player'),
              child: const Text('open player'),
            ),
          ),
        ),
        GoRoute(path: '/player', builder: (_, __) => const PlayerScreen()),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          playerProvider.overrideWith((ref) => notifier),
          apiClientProvider.overrideWithValue(client),
          downloadServiceProvider.overrideWithValue(downloads),
          skinProvider.overrideWith((ref) => SkinNotifier()..state = skin),
        ],
        child: MaterialApp.router(
          routerConfig: router,
          theme: buildTheme(AppColors.current, skin),
        ),
      ),
    );
    await tester.tap(find.text('open player'));
    await tester.pumpAndSettle();
    expect(find.text('Title a'), findsOneWidget);
  }

  testWidgets('pulling down anywhere on the screen closes the player',
      (tester) async {
    await pumpPlayer(tester);

    // Start the drag on the song title — well away from the cover art, the
    // only place this used to work.
    await tester.fling(find.text('Title a'), const Offset(0, 300), 1500);
    await tester.pumpAndSettle();

    expect(find.text('Title a'), findsNothing);
    expect(find.text('open player'), findsOneWidget);
  });

  testWidgets('the screen follows the finger while it is pulled down',
      (tester) async {
    await pumpPlayer(tester);
    final before = tester.getTopLeft(find.byType(AppBar)).dy;

    final g = await tester.startGesture(tester.getCenter(find.text('Title a')));
    await g.moveBy(const Offset(0, 40));
    await g.moveBy(const Offset(0, 40));
    await tester.pump();

    expect(tester.getTopLeft(find.byType(AppBar)).dy, greaterThan(before + 40));
    await g.up();
    await tester.pumpAndSettle();
  });

  testWidgets('a short, slow pull springs back instead of closing',
      (tester) async {
    await pumpPlayer(tester);

    final g = await tester.startGesture(tester.getCenter(find.text('Title a')));
    await g.moveBy(const Offset(0, 30));
    await g.moveBy(const Offset(0, 30));
    await tester.pump(const Duration(milliseconds: 400)); // let it come to rest
    await g.up();
    await tester.pumpAndSettle();

    expect(find.text('Title a'), findsOneWidget);
    expect(tester.getTopLeft(find.byType(AppBar)).dy, 0);
  });

  testWidgets('a horizontal drag does not close the player', (tester) async {
    await pumpPlayer(tester);

    await tester.fling(find.text('Title a'), const Offset(-200, 20), 1500);
    await tester.pumpAndSettle();

    expect(find.text('Title a'), findsOneWidget);
  });

  testWidgets(
      "Vista's player paints its own backdrop, so the page under it cannot show through",
      (tester) async {
    await pumpPlayer(tester, skin: AppSkin.vista);
    expect(
        find.descendant(
            of: find.byType(PlayerScreen), matching: find.byType(SkinBackdrop)),
        findsOneWidget);
  });
}
