import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';

import '../helpers/mocks.dart';

const _saved =
    Lyrics(synced: true, line: [LyricsLine(start: 0, value: 'saved')]);
const _online =
    Lyrics(synced: false, line: [LyricsLine(start: 0, value: 'online')]);

void main() {
  setUpAll(() => registerFallbackValue(_saved));

  late MockSubsonicClient client;
  late MockDownloadService downloads;

  setUp(() {
    client = MockSubsonicClient();
    downloads = MockDownloadService();
    when(() => downloads.localLyrics(any())).thenAnswer((_) async => null);
    when(() => downloads.isDownloaded(any())).thenAnswer((_) async => false);
    when(() => downloads.saveLyrics(any(), any())).thenAnswer((_) async {});
    when(() => client.getLyrics(any())).thenAnswer((_) async => _online);
  });

  ProviderContainer container({bool signedIn = true}) {
    final c = ProviderContainer(overrides: [
      downloadServiceProvider.overrideWithValue(downloads),
      if (signedIn) apiClientProvider.overrideWithValue(client),
    ]);
    addTearDown(c.dispose);
    return c;
  }

  test('a downloaded song\'s saved lyrics win, so they work offline', () async {
    when(() => downloads.localLyrics('s1')).thenAnswer((_) async => _saved);

    final lyrics = await container().read(lyricsProvider('s1').future);

    expect(lyrics, same(_saved));
    verifyNever(() => client.getLyrics(any()));
  });

  test('saved lyrics are used even with no signed-in client', () async {
    when(() => downloads.localLyrics('s1')).thenAnswer((_) async => _saved);

    final lyrics =
        await container(signedIn: false).read(lyricsProvider('s1').future);

    expect(lyrics, same(_saved));
  });

  test('a song that is not downloaded gets its lyrics from the server',
      (() async {
    final lyrics = await container().read(lyricsProvider('s1').future);

    expect(lyrics, same(_online));
    verifyNever(() => downloads.saveLyrics(any(), any()));
  }));

  test('a song downloaded before lyrics were saved keeps them from now on',
      () async {
    when(() => downloads.isDownloaded('s1')).thenAnswer((_) async => true);

    await container().read(lyricsProvider('s1').future);

    verify(() => downloads.saveLyrics('s1', _online)).called(1);
  });

  test('a failing downloads lookup does not stop the server fetch', () async {
    when(() => downloads.localLyrics(any()))
        .thenAnswer((_) async => throw Exception('db closed'));

    final lyrics = await container().read(lyricsProvider('s1').future);

    expect(lyrics, same(_online));
  });
}
