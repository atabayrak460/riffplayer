import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/widgets/cover_art.dart';
import 'package:riffplayer_mobile/widgets/song_cover.dart';

import '../helpers/mocks.dart';

const _song = Song(
  id: 's1',
  title: 'T',
  artist: 'A',
  artistId: 'ar',
  album: 'Al',
  albumId: 'al',
  coverArt: 'cov-1',
  suffix: 'mp3',
);

void main() {
  late MockDownloadService downloads;
  late MockSubsonicClient client;

  setUp(() {
    downloads = MockDownloadService();
    client = MockSubsonicClient();
    when(() => client.coverArtUrl(any(), size: any(named: 'size')))
        .thenReturn('http://test/cover');
  });

  Future<void> pump(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        downloadServiceProvider.overrideWithValue(downloads),
        apiClientProvider.overrideWithValue(client),
      ],
      child: const MaterialApp(
        home: Scaffold(
          body: SongCover(song: _song, size: 44, remoteSize: 100),
        ),
      ),
    ));
    await tester.pump();
    await tester.pump();
  }

  testWidgets('shows the server cover when the song is not downloaded',
      (tester) async {
    when(() => downloads.localCoverPath('s1')).thenAnswer((_) async => null);

    await pump(tester);

    expect(find.byType(CoverArt), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w is Image && w.image is FileImage),
        findsNothing);
  });

  testWidgets('shows the saved copy for a downloaded song, without the network',
      (tester) async {
    final dir = Directory.systemTemp.createTempSync('songcover');
    addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/c.jpg')..writeAsBytesSync([0, 1, 2]);
    when(() => downloads.localCoverPath('s1'))
        .thenAnswer((_) async => file.path);

    await pump(tester);

    final image = tester.widget<Image>(
        find.byWidgetPredicate((w) => w is Image && w.image is FileImage));
    expect((image.image as FileImage).file.path, file.path);
    expect(find.byType(CoverArt), findsNothing);
  });

  testWidgets('a downloads lookup that throws falls back to the server cover',
      (tester) async {
    when(() => downloads.localCoverPath('s1'))
        .thenAnswer((_) async => throw Exception('db closed'));

    await pump(tester);

    expect(find.byType(CoverArt), findsOneWidget);
  });
}
