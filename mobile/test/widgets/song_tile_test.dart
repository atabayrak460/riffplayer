import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/widgets/song_tile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
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
    when(() => downloads.localPath(any())).thenAnswer((_) async => null);
    when(() => client.streamUrl(any())).thenReturn('http://test/stream');
    when(() => client.scrobble(any(), submission: any(named: 'submission')))
        .thenAnswer((_) async {});
  });

  Future<PlayerNotifier> pumpTile(
    WidgetTester tester, {
    required Song song,
    List<Song>? queue,
    VoidCallback? onRemove,
    Song? nowPlaying,
    bool showAlbum = false,
    DateTime? addedAt,
  }) async {
    final notifier = PlayerNotifier(handler);
    if (nowPlaying != null) {
      await notifier.playSong(nowPlaying, client, downloads);
    }

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          playerProvider.overrideWith((ref) => notifier),
          apiClientProvider.overrideWithValue(client),
          downloadServiceProvider.overrideWithValue(downloads),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: SongTile(
              song: song,
              queue: queue,
              onRemove: onRemove,
              showAlbum: showAlbum,
              addedAt: addedAt,
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    return notifier;
  }

  group('rendering', () {
    testWidgets(
        'the date added sits under the artist, leaving the title its room '
        '(All Songs on a phone-width screen)', (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await pumpTile(tester,
          song: _song('a'), showAlbum: true, addedAt: DateTime(2026, 10, 3));

      final title = tester.getRect(find.text('Title a'));
      final artist = tester.getRect(find.textContaining('Artist a'));
      final date = tester.getRect(find.text('Oct 3, 2026'));
      // Before: the date sat in the trailing column and the title got no room.
      expect(title.width, greaterThan(90));
      expect(date.top, greaterThanOrEqualTo(artist.bottom));
      expect(date.left, artist.left);
    });

    testWidgets('without a date there is no extra line', (tester) async {
      await pumpTile(tester, song: _song('a'), showAlbum: true);
      expect(find.text('Oct 3, 2026'), findsNothing);
    });

    testWidgets('shows the title, artist and duration', (tester) async {
      await pumpTile(tester, song: _song('a'));

      expect(find.text('Title a'), findsOneWidget);
      expect(find.text('Artist a'), findsOneWidget);
      expect(find.text('3:20'), findsOneWidget);
    });

    testWidgets('shows the now-playing indicator icon for the current song',
        (tester) async {
      final song = _song('a');
      await pumpTile(tester, song: song, nowPlaying: song);

      expect(find.byIcon(Icons.graphic_eq), findsOneWidget);
    });

    testWidgets('does not show the now-playing indicator for other songs',
        (tester) async {
      await pumpTile(tester, song: _song('a'), nowPlaying: _song('b'));

      expect(find.byIcon(Icons.graphic_eq), findsNothing);
    });
  });

  group('tap behavior', () {
    testWidgets('tapping the row plays the song through the queue',
        (tester) async {
      final a = _song('a');
      final b = _song('b');
      final notifier = await pumpTile(tester, song: b, queue: [a, b]);

      await tester.tap(find.text('Title b'));
      await tester.pump();

      expect(notifier.state.currentSong?.id, 'b');
      verify(() => handler.playQueue(any(), 1)).called(1);
    });

    testWidgets('a custom onTap overrides the default play behavior',
        (tester) async {
      var tapped = false;
      final notifier = PlayerNotifier(handler);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            playerProvider.overrideWith((ref) => notifier),
            apiClientProvider.overrideWithValue(client),
            downloadServiceProvider.overrideWithValue(downloads),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: SongTile(song: _song('a'), onTap: () => tapped = true),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Title a'));
      await tester.pump();

      expect(tapped, isTrue);
      expect(notifier.state.currentSong, isNull);
    });
  });

  group('overflow menu', () {
    testWidgets('"Add to queue" calls addToQueue and shows a confirmation',
        (tester) async {
      final current = _song('current');
      final a = _song('a');
      final notifier = await pumpTile(tester, song: a, nowPlaying: current);

      await tester.tap(find.byIcon(Icons.more_vert));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Add to queue'));
      await tester.pumpAndSettle();

      expect(notifier.state.queue.map((s) => s.id), ['current', 'a']);
      expect(find.text('Added to queue'), findsOneWidget);
    });

    testWidgets('"Remove from queue" only appears when onRemove is set',
        (tester) async {
      await pumpTile(tester, song: _song('a'));
      await tester.tap(find.byIcon(Icons.more_vert));
      await tester.pumpAndSettle();
      expect(find.text('Remove from queue'), findsNothing);
      await tester.tapAt(const Offset(10, 10)); // close the menu
      await tester.pumpAndSettle();

      await pumpTile(tester, song: _song('a'), onRemove: () {});
      await tester.tap(find.byIcon(Icons.more_vert));
      await tester.pumpAndSettle();
      expect(find.text('Remove from queue'), findsOneWidget);
    });

    testWidgets('"Remove from queue" calls the onRemove callback',
        (tester) async {
      var removed = false;
      await pumpTile(tester, song: _song('a'), onRemove: () => removed = true);

      await tester.tap(find.byIcon(Icons.more_vert));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove from queue'));
      await tester.pumpAndSettle();

      expect(removed, isTrue);
    });
  });

  group('swipe to queue', () {
    testWidgets('swiping right adds the song to the queue', (tester) async {
      final current = _song('current');
      final a = _song('a');
      final notifier = await pumpTile(tester, song: a, nowPlaying: current);

      await tester.timedDrag(
        find.byType(SongTile),
        const Offset(400, 0),
        const Duration(milliseconds: 300),
      );
      await tester.pumpAndSettle();

      expect(notifier.state.queue.map((s) => s.id), ['current', 'a']);
      expect(find.text('Added to queue'), findsOneWidget);
    });

    testWidgets('the currently-playing row cannot be swiped to queue itself',
        (tester) async {
      final current = _song('current');
      final notifier =
          await pumpTile(tester, song: current, nowPlaying: current);

      await tester.timedDrag(
        find.byType(SongTile),
        const Offset(400, 0),
        const Duration(milliseconds: 300),
      );
      await tester.pumpAndSettle();

      expect(notifier.state.queue.map((s) => s.id), ['current']);
    });

    testWidgets('swiping left calls onRemove when it is set', (tester) async {
      var removed = false;
      await pumpTile(tester, song: _song('a'), onRemove: () => removed = true);

      await tester.timedDrag(
        find.byType(SongTile),
        const Offset(-400, 0),
        const Duration(milliseconds: 300),
      );
      await tester.pumpAndSettle();

      expect(removed, isTrue);
    });
  });
}
