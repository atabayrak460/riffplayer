import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/providers/radio_provider.dart';

import '../helpers/mocks.dart';

Song _song(String id) => Song(
      id: id,
      title: 'Song $id',
      artist: 'Artist',
      artistId: 'ar',
      album: 'Album',
      albumId: 'al',
      suffix: 'mp3',
      duration: 200,
    );

List<Song> _songs(int from, int n) =>
    [for (var i = 0; i < n; i++) _song('${from + i}')];

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  setUpAll(registerMockFallbackValues);

  late MockAudioHandler handler;
  late MockSubsonicClient client;
  late MockDownloadService downloads;
  late ProviderContainer container;
  late PlayerNotifier player;

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
    when(() => handler.insertAt(any(), any())).thenAnswer((_) async {});
    when(() => handler.playFromIndex(any())).thenAnswer((_) async {});
    when(() => downloads.localPath(any())).thenAnswer((_) async => null);
    when(() => client.streamUrl(any())).thenReturn('http://test/stream');
    when(() => client.scrobble(any(), submission: any(named: 'submission')))
        .thenAnswer((_) async {});

    player = PlayerNotifier(handler);
    container = ProviderContainer(overrides: [
      playerProvider.overrideWith((ref) => player),
      apiClientProvider.overrideWithValue(client),
      downloadServiceProvider.overrideWithValue(downloads),
    ]);
    addTearDown(container.dispose);
  });

  RadioNotifier radio() => container.read(radioProvider.notifier);
  void stubRadio(List<Song> songs) => when(() => client.getRadio(any(), any(),
      count: any(named: 'count'),
      exclude: any(named: 'exclude'))).thenAnswer((_) async => songs);

  test('starts with the seed first and the server\'s picks after it', () async {
    stubRadio(_songs(1, 30));
    final problem = await radio()
        .start(const RadioSeed('song', 's0', 'Seed'), firstSong: _song('s0'));

    expect(problem, isNull);
    expect(player.state.queue.first.id, 's0');
    expect(player.state.queue.length, 31);
    expect(container.read(radioProvider)?.name, 'Seed');
    verify(() => client.getRadio('song', 's0', count: 30, exclude: ['s0']))
        .called(1);
  });

  test('never queues the seed twice', () async {
    stubRadio([_song('s0'), _song('1')]);
    await radio()
        .start(const RadioSeed('song', 's0', 'Seed'), firstSong: _song('s0'));
    expect(player.state.queue.map((s) => s.id), ['s0', '1']);
  });

  test('says so when there is nothing to play, and does not start', () async {
    stubRadio(const []);
    final problem = await radio().start(const RadioSeed('artist', 'a', 'Band'));
    expect(problem, contains('enough music'));
    expect(container.read(radioProvider), isNull);
    expect(player.state.queue, isEmpty);
  });

  test('a failure becomes a message, not an exception', () async {
    when(() => client.getRadio(any(), any(),
        count: any(named: 'count'),
        exclude: any(named: 'exclude'))).thenThrow(Exception('offline'));
    final problem = await radio().start(const RadioSeed('album', 'x', 'Al'));
    expect(problem, isNotNull);
    expect(container.read(radioProvider), isNull);
  });

  test('tops the queue up when only a few songs are left', () async {
    stubRadio(_songs(1, 12)); // 13 queued with the seed
    container.read(radioProvider); // make sure the listener exists
    await radio()
        .start(const RadioSeed('song', 's0', 'Seed'), firstSong: _song('s0'));
    stubRadio(_songs(100, 5));

    await player.playFromQueueIndex(10); // queue is now 3 songs long
    await _settle();

    expect(player.state.queue.length, 8);
    verify(() => client.getRadio('song', 's0',
        count: 30, exclude: any(named: 'exclude'))).called(2);
  });

  test('switches itself off when the user plays something else', () async {
    stubRadio(_songs(1, 30));
    await radio()
        .start(const RadioSeed('song', 's0', 'Seed'), firstSong: _song('s0'));
    await player.playSong(_song('x1'), client, downloads,
        queue: [_song('x1'), _song('x2')], queueIndex: 0);
    await _settle();
    expect(container.read(radioProvider), isNull);
  });

  test('stop() ends it at once', () async {
    stubRadio(_songs(1, 30));
    await radio()
        .start(const RadioSeed('song', 's0', 'Seed'), firstSong: _song('s0'));
    radio().stop();
    expect(container.read(radioProvider), isNull);
  });
}
