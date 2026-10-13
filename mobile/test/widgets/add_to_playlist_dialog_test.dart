import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/widgets/add_to_playlist_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import '../helpers/mocks.dart';

Song _song(String id) => Song(
      id: id,
      title: 'Title $id',
      artist: 'Artist',
      artistId: 'artist-1',
      album: 'Album',
      albumId: 'album-1',
      suffix: 'mp3',
      duration: 200,
    );

Playlist _playlist({List<Song>? entries}) => Playlist(
      id: 'p-1',
      name: 'My Playlist',
      owner: 'admin',
      songCount: entries?.length ?? 0,
      duration: 0,
      entries: entries,
    );

void main() {
  late MockSubsonicClient client;

  setUp(() {
    client = MockSubsonicClient();
    when(() => client.getPlaylists()).thenAnswer((_) async => [_playlist()]);
    when(() => client.addSongToPlaylist(any(), any())).thenAnswer((_) async {});
  });

  Future<void> openDialog(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(client)],
        child: MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => showDialog(
                  context: context,
                  builder: (_) => const AddToPlaylistDialog(songId: 's-1'),
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Future<void> openDialogAndPick(WidgetTester tester) async {
    await openDialog(tester);
    await tester.tap(find.text('My Playlist'));
    await tester.pumpAndSettle();
  }

  testWidgets('adds a song that is not in the playlist yet', (tester) async {
    when(() => client.getPlaylist('p-1'))
        .thenAnswer((_) async => _playlist(entries: [_song('other')]));

    await openDialogAndPick(tester);

    verify(() => client.addSongToPlaylist('p-1', 's-1')).called(1);
    expect(find.byType(AddToPlaylistDialog), findsNothing);
    expect(find.text('Already in "My Playlist"'), findsNothing);
    expect(find.text('Added to "My Playlist"'), findsOneWidget);
  });

  testWidgets('shows a failure snackbar when adding throws', (tester) async {
    when(() => client.getPlaylist('p-1'))
        .thenAnswer((_) async => _playlist(entries: const []));
    when(() => client.addSongToPlaylist(any(), any()))
        .thenAnswer((_) async => throw Exception('boom'));

    await openDialogAndPick(tester);

    expect(find.text('Failed to add to playlist'), findsOneWidget);
    expect(find.text('Added to "My Playlist"'), findsNothing);
  });

  testWidgets('"New playlist" confirms with a snackbar', (tester) async {
    when(() => client.createPlaylist(any()))
        .thenAnswer((_) async => _playlist());

    await openDialog(tester);
    await tester.tap(find.text('New playlist'));
    await tester.pumpAndSettle();

    verify(() => client.createPlaylist('New Playlist 2')).called(1);
    verify(() => client.addSongToPlaylist('p-1', 's-1')).called(1);
    expect(find.text('Added to "New Playlist 2"'), findsOneWidget);
  });

  testWidgets('a long playlist list scrolls, so the last one is reachable',
      (tester) async {
    tester.view.physicalSize = const Size(800, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    when(() => client.getPlaylists()).thenAnswer((_) async => [
          for (var i = 0; i < 40; i++)
            Playlist(
                id: 'p-$i',
                name: 'List $i',
                owner: 'admin',
                songCount: 0,
                duration: 0),
        ]);
    when(() => client.getPlaylist('p-39'))
        .thenAnswer((_) async => _playlist(entries: const []));

    await openDialog(tester);
    await tester.scrollUntilVisible(find.text('List 39'), 200,
        scrollable: find.descendant(
            of: find.byType(AddToPlaylistDialog),
            matching: find.byType(Scrollable)));
    await tester.tap(find.text('List 39'));
    await tester.pumpAndSettle();

    verify(() => client.addSongToPlaylist('p-39', 's-1')).called(1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'does not re-add a song already in the playlist, shows a snackbar',
      (tester) async {
    when(() => client.getPlaylist('p-1'))
        .thenAnswer((_) async => _playlist(entries: [_song('s-1')]));

    await openDialogAndPick(tester);

    verifyNever(() => client.addSongToPlaylist(any(), any()));
    expect(find.byType(AddToPlaylistDialog), findsNothing);
    expect(find.text('Already in "My Playlist"'), findsOneWidget);
  });
}
