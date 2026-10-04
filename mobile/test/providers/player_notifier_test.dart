import 'dart:async';

import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/connect/connect_models.dart' show CommandType;
import 'package:riffplayer_mobile/connect/remote_controller.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:mocktail/mocktail.dart';

import '../helpers/mocks.dart';

Song _song(String id, {String? starred}) => Song(
      id: id,
      title: 'Title $id',
      artist: 'Artist',
      artistId: 'artist-1',
      album: 'Album',
      albumId: 'album-1',
      suffix: 'mp3',
      starred: starred,
    );

class _FakeRemote implements RemoteController {
  @override
  bool isRemote = true;
  final commands = <(CommandType, int?)>[];
  int localStarts = 0;
  final volumes = <double>[];
  final adds = <Song>[];
  final removes = <int>[];
  final moves = <(int, int)>[];

  @override
  double get volume => 0.5;
  @override
  void setVolume(double volume) => volumes.add(volume);
  @override
  void queueAdd(Song song) => adds.add(song);
  @override
  void queueRemove(int index) => removes.add(index);
  @override
  void queueMove(int from, int to) => moves.add((from, to));

  @override
  void command(CommandType type, {int? positionMs}) =>
      commands.add((type, positionMs));

  @override
  void onLocalStart() => localStarts++;
}

void main() {
  setUpAll(() {
    registerMockFallbackValues();
    registerFallbackValue(Duration.zero);
  });

  late MockAudioHandler handler;
  late MockSubsonicClient client;
  late MockDownloadService downloads;
  late PlayerNotifier notifier;

  setUp(() {
    handler = MockAudioHandler();
    client = MockSubsonicClient();
    downloads = MockDownloadService();

    // PlayerNotifier's constructor subscribes to every one of these
    // immediately, so even tests that don't care about a given stream still
    // need it stubbed — an unstubbed stream getter throws.
    when(() => handler.positionStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.durationStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.playingStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.currentIndexStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.shuffleModeEnabledStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.loopModeStream).thenAnswer((_) => const Stream.empty());

    when(() => handler.insertAt(any(), any())).thenAnswer((_) async {});
    when(() => handler.removeQueueItemAt(any())).thenAnswer((_) async {});
    when(() => handler.moveQueueItem(any(), any())).thenAnswer((_) async {});
    when(() => handler.clearQueue()).thenAnswer((_) async {});
    when(() => handler.playFromIndex(any())).thenAnswer((_) async {});
    when(() => handler.playQueue(any(), any())).thenAnswer((_) async {});
    when(() => handler.setLoopMode(any())).thenAnswer((_) async {});
    when(() => handler.setShuffleModeEnabled(any())).thenAnswer((_) async {});
    when(() => handler.skipToNext()).thenAnswer((_) async {});
    when(() => handler.skipToPrevious()).thenAnswer((_) async {});

    // buildAudioSource() (called by playSong/addToQueue) always checks for a
    // local download first — no test here downloads anything, so it always
    // falls through to the streamed URL.
    when(() => downloads.localPath(any())).thenAnswer((_) async => null);
    when(() => client.streamUrl(any())).thenReturn('http://test/stream');
    when(() => client.scrobble(any(), submission: any(named: 'submission')))
        .thenAnswer((_) async {});

    notifier = PlayerNotifier(handler);
  });

  group('addToQueue', () {
    test('starts playback from scratch when nothing is queued', () async {
      final a = _song('a');

      await notifier.addToQueue(a, client, downloads);

      expect(notifier.state.queue, [a]);
      expect(notifier.state.currentIndex, 0);
      verify(() => handler.insertAt(0, any())).called(1);
    });

    test('inserts right after the current track', () async {
      final current = _song('current');
      final a = _song('a');
      await notifier.playSong(current, client, downloads);

      await notifier.addToQueue(a, client, downloads);

      expect(notifier.state.queue.map((s) => s.id), ['current', 'a']);
      verify(() => handler.insertAt(1, any())).called(1);
    });

    test('queueing A then B plays current -> A -> B, not current -> B -> A',
        () async {
      final current = _song('current');
      final a = _song('a');
      final b = _song('b');
      await notifier.playSong(current, client, downloads);

      await notifier.addToQueue(a, client, downloads);
      await notifier.addToQueue(b, client, downloads);

      expect(notifier.state.queue.map((s) => s.id), ['current', 'a', 'b']);
      verify(() => handler.insertAt(1, any())).called(1);
      verify(() => handler.insertAt(2, any())).called(1);
    });

    // Regression test for a real bug found on-device: flutter_slidable's
    // swipe-to-queue gesture could dispatch two addToQueue() calls for one
    // swipe (confirmDismiss + SlidableAction.onPressed both firing). Before
    // the fix, addToQueue read `state.currentIndex`/`_queuedCount` before
    // awaiting `_handler.insertAt()`, then combined that stale index with a
    // freshly-read `state.queue` afterward — two overlapping calls raced on
    // that gap, throwing a RangeError and silently dropping the add.
    test(
        'two calls fired back to back before either resolves do not race or throw',
        () async {
      final current = _song('current');
      final a = _song('a');
      final b = _song('b');
      await notifier.playSong(current, client, downloads);

      // Gate handler.insertAt so both addToQueue calls are genuinely
      // in-flight at once before either's post-await state write lands.
      final gate = Completer<void>();
      when(() => handler.insertAt(any(), any())).thenAnswer((_) => gate.future);

      final futureA = notifier.addToQueue(a, client, downloads);
      final futureB = notifier.addToQueue(b, client, downloads);
      gate.complete();

      await expectLater(Future.wait([futureA, futureB]), completes);
      expect(notifier.state.queue.map((s) => s.id), ['current', 'a', 'b']);
    });

    test(
        'racing a clearQueue() mid-flight does not throw (regression — used to '
        'crash with a RangeError when state.queue emptied out from under a '
        'stale pre-await insert index)', () async {
      final current = _song('current');
      final a = _song('a');
      await notifier.playSong(current, client, downloads);

      final gate = Completer<void>();
      when(() => handler.insertAt(any(), any())).thenAnswer((_) => gate.future);

      final addFuture = notifier.addToQueue(a, client, downloads);
      final clearFuture = notifier.clearQueue();
      gate.complete();

      await expectLater(Future.wait([addFuture, clearFuture]), completes);
      // Serialized in call order: the add lands first (queue becomes
      // [current, a]), then clearQueue empties it — never a crash either way.
      expect(notifier.state.queue, isEmpty);
      expect(notifier.state.currentIndex, -1);
    });
  });

  group('playSong', () {
    test('with no queue given, plays just that song at index 0', () async {
      final a = _song('a');

      await notifier.playSong(a, client, downloads);

      expect(notifier.state.queue, [a]);
      expect(notifier.state.currentIndex, 0);
      verify(() => handler.playQueue(any(), 0)).called(1);
    });

    test('an explicit queueIndex is trusted over searching the queue',
        () async {
      final a = _song('a');
      final b = _song('b');

      await notifier.playSong(b, client, downloads,
          queue: [a, b], queueIndex: 1);

      expect(notifier.state.currentIndex, 1);
      verify(() => handler.playQueue(any(), 1)).called(1);
    });

    test('without an explicit index, finds the song by id within the queue',
        () async {
      final a = _song('a');
      final b = _song('b');
      final c = _song('c');

      await notifier.playSong(b, client, downloads, queue: [a, b, c]);

      expect(notifier.state.currentIndex, 1);
      verify(() => handler.playQueue(any(), 1)).called(1);
    });

    test('falls back to index 0 when the song is not found in the queue',
        () async {
      final a = _song('a');
      final b = _song('b');
      final other = _song('not-in-queue');

      await notifier.playSong(other, client, downloads, queue: [a, b]);

      expect(notifier.state.currentIndex, 0);
      verify(() => handler.playQueue(any(), 0)).called(1);
    });
  });

  group('removeFromQueue', () {
    test('leaves currentIndex alone when removing a song after it', () async {
      final current = _song('current');
      final a = _song('a');
      await notifier.playSong(current, client, downloads,
          queue: [current, a], queueIndex: 0);

      await notifier.removeFromQueue(1);

      expect(notifier.state.queue.map((s) => s.id), ['current']);
      expect(notifier.state.currentIndex, 0);
    });

    test('shifts currentIndex down when removing a song before it', () async {
      final before = _song('before');
      final current = _song('current');
      await notifier.playSong(current, client, downloads,
          queue: [before, current], queueIndex: 1);

      await notifier.removeFromQueue(0);

      expect(notifier.state.queue.map((s) => s.id), ['current']);
      expect(notifier.state.currentIndex, 0);
    });
  });

  group('reorderQueue', () {
    test('moves a song from one index to another', () async {
      final a = _song('a');
      final b = _song('b');
      final c = _song('c');
      await notifier.playSong(a, client, downloads,
          queue: [a, b, c], queueIndex: 0);

      await notifier.reorderQueue(2, 0);

      expect(notifier.state.queue.map((s) => s.id), ['c', 'a', 'b']);
      verify(() => handler.moveQueueItem(2, 0)).called(1);
    });
  });

  group('clearQueue', () {
    test('empties the queue and resets playback state', () async {
      final a = _song('a');
      await notifier.playSong(a, client, downloads);

      await notifier.clearQueue();

      expect(notifier.state.queue, isEmpty);
      expect(notifier.state.currentIndex, -1);
      expect(notifier.state.playing, isFalse);
    });

    test('a fresh addToQueue after clearing starts a new block from scratch',
        () async {
      final a = _song('a');
      final b = _song('b');
      final c = _song('c');
      await notifier.playSong(a, client, downloads);
      await notifier.addToQueue(b, client, downloads);
      await notifier.clearQueue();

      await notifier.addToQueue(c, client, downloads);

      expect(notifier.state.queue, [c]);
      expect(notifier.state.currentIndex, 0);
    });
  });

  group('playFromQueueIndex', () {
    test('drops everything before the target index', () async {
      final a = _song('a');
      final b = _song('b');
      final c = _song('c');
      await notifier.playSong(a, client, downloads,
          queue: [a, b, c], queueIndex: 0);

      await notifier.playFromQueueIndex(2);

      expect(notifier.state.queue.map((s) => s.id), ['c']);
      expect(notifier.state.currentIndex, 0);
      verify(() => handler.playFromIndex(2)).called(1);
    });
  });

  group('setStarredInQueue', () {
    test('patches only the matching song, leaving others untouched', () async {
      final a = _song('a');
      final b = _song('b');
      await notifier.playSong(a, client, downloads,
          queue: [a, b], queueIndex: 0);

      notifier.setStarredInQueue('b', 'true');

      expect(notifier.state.queue[0].isStarred, isFalse);
      expect(notifier.state.queue[1].isStarred, isTrue);
    });
  });

  group('simple delegations', () {
    test('next() and previous() delegate straight to the handler', () {
      notifier.next();
      notifier.previous();

      verify(() => handler.skipToNext()).called(1);
      verify(() => handler.skipToPrevious()).called(1);
    });

    test('toggleShuffle() flips the current shuffle state', () {
      notifier.toggleShuffle();
      verify(() => handler.setShuffleModeEnabled(true)).called(1);
    });
  });

  group('toggleRepeat', () {
    test(
        'cycles off -> all -> one -> off as the handler reports each mode back',
        () async {
      final loopModeController = StreamController<LoopMode>();
      addTearDown(loopModeController.close);
      when(() => handler.loopModeStream)
          .thenAnswer((_) => loopModeController.stream);
      // Rebuild so the notifier subscribes to the controller-backed stream
      // instead of the empty one from setUp().
      notifier = PlayerNotifier(handler);

      notifier.toggleRepeat();
      verify(() => handler.setLoopMode(LoopMode.all)).called(1);
      loopModeController.add(LoopMode.all);
      await pumpEventQueue();

      notifier.toggleRepeat();
      verify(() => handler.setLoopMode(LoopMode.one)).called(1);
      loopModeController.add(LoopMode.one);
      await pumpEventQueue();

      notifier.toggleRepeat();
      verify(() => handler.setLoopMode(LoopMode.off)).called(1);
    });
  });

  group('submission scrobble threshold', () {
    late StreamController<Duration> position;
    late StreamController<Duration?> duration;

    setUp(() async {
      position = StreamController<Duration>();
      duration = StreamController<Duration?>();
      addTearDown(position.close);
      addTearDown(duration.close);
      when(() => handler.positionStream).thenAnswer((_) => position.stream);
      when(() => handler.durationStream).thenAnswer((_) => duration.stream);
      notifier = PlayerNotifier(handler);
      await notifier.playSong(_song('a'), client, downloads);
      clearInteractions(client);
    });

    Future<void> tick(Duration pos) async {
      position.add(pos);
      await pumpEventQueue();
    }

    Future<void> setDuration(Duration d) async {
      duration.add(d);
      await pumpEventQueue();
    }

    void verifySubmissions(int times) =>
        verify(() => client.scrobble('a', submission: true)).called(times);

    test('a long track scrobbles at 30s, not at 50%', () async {
      await setDuration(const Duration(minutes: 10));

      await tick(const Duration(seconds: 29));
      verifyNever(() => client.scrobble(any(), submission: true));

      await tick(const Duration(seconds: 30));
      verifySubmissions(1);
    });

    test('a short track scrobbles at 50% of its length', () async {
      await setDuration(const Duration(seconds: 40));

      await tick(const Duration(seconds: 19));
      verifyNever(() => client.scrobble(any(), submission: true));

      await tick(const Duration(seconds: 20));
      verifySubmissions(1);
    });

    test('unknown duration falls back to the 30s threshold', () async {
      await tick(const Duration(seconds: 29));
      verifyNever(() => client.scrobble(any(), submission: true));

      await tick(const Duration(seconds: 30));
      verifySubmissions(1);
    });

    test('submits only once per track however far playback continues',
        () async {
      await setDuration(const Duration(minutes: 3));

      await tick(const Duration(seconds: 31));
      await tick(const Duration(seconds: 45));
      await tick(const Duration(seconds: 90));

      verifySubmissions(1);
    });

    test('playing the same song again submits a second play', () async {
      await tick(const Duration(seconds: 31));
      verifySubmissions(1);

      await notifier.playSong(_song('a'), client, downloads);
      await tick(const Duration(seconds: 31));

      // mocktail's verify consumes the calls it matched, so this counts
      // only the new one.
      verifySubmissions(1);
    });

    test('repeat-one looping back to the start submits a second play',
        () async {
      await setDuration(const Duration(minutes: 3));
      await tick(const Duration(seconds: 31));
      await tick(const Duration(minutes: 2, seconds: 59));
      verifySubmissions(1);

      await tick(const Duration(milliseconds: 100));
      await tick(const Duration(seconds: 31));

      // mocktail's verify consumes the calls it matched, so this counts
      // only the new one.
      verifySubmissions(1);
    });

    test('seeking back after a submission does not submit again', () async {
      await setDuration(const Duration(minutes: 3));
      await tick(const Duration(seconds: 40));
      await tick(const Duration(seconds: 5));
      await tick(const Duration(seconds: 40));

      verifySubmissions(1);
    });

    test('position ticks before any song is playing submit nothing', () async {
      final idlePosition = StreamController<Duration>();
      addTearDown(idlePosition.close);
      when(() => handler.positionStream).thenAnswer((_) => idlePosition.stream);
      when(() => handler.durationStream)
          .thenAnswer((_) => const Stream.empty());
      final idle = PlayerNotifier(handler);

      idlePosition.add(const Duration(minutes: 1));
      await pumpEventQueue();

      expect(idle.state.currentSong, isNull);
      verifyNever(() => client.scrobble(any(), submission: true));
    });
  });
  group('now-playing scrobble', () {
    late StreamController<int?> index;
    final queue = [_song('a'), _song('b'), _song('c')];

    setUp(() async {
      index = StreamController<int?>();
      addTearDown(index.close);
      when(() => handler.currentIndexStream).thenAnswer((_) => index.stream);
      notifier = PlayerNotifier(handler);
      await notifier.playSong(queue[0], client, downloads, queue: queue);
    });

    Future<void> skipTo(int? i) async {
      index.add(i);
      await pumpEventQueue();
    }

    void verifyNowPlaying(String id, int times) =>
        verify(() => client.scrobble(id, submission: false)).called(times);

    test('playSong announces the starting song exactly once', () async {
      await skipTo(0);

      verifyNowPlaying('a', 1);
    });

    test('skipping to another track announces it', () async {
      verifyNowPlaying('a', 1);

      await skipTo(1);
      verifyNowPlaying('b', 1);

      await skipTo(2);
      verifyNowPlaying('c', 1);
    });

    test('the index stream repeating the same track does not re-announce',
        () async {
      await skipTo(1);
      await skipTo(1);

      verifyNowPlaying('b', 1);
    });

    test('an index of null (nothing playing) announces nothing', () async {
      clearInteractions(client);

      await skipTo(null);

      verifyNever(
          () => client.scrobble(any(), submission: any(named: 'submission')));
    });

    test('a skip is only a now-playing ping, never a submission', () async {
      await skipTo(1);

      verifyNever(() => client.scrobble(any(), submission: true));
    });

    test('before any playSong there is no client, so nothing is sent',
        () async {
      final idleIndex = StreamController<int?>();
      addTearDown(idleIndex.close);
      when(() => handler.currentIndexStream)
          .thenAnswer((_) => idleIndex.stream);
      final idle = PlayerNotifier(handler);
      clearInteractions(client);

      idleIndex.add(1);
      await pumpEventQueue();

      expect(idle.state.currentSong, isNull);
      verifyNever(
          () => client.scrobble(any(), submission: any(named: 'submission')));
    });
  });
  group('replay detected by listening time (position never wraps)', () {
    // Some players keep reporting the last position (clamped to the track
    // length) for a repeat-one loop instead of jumping back to 0, so the
    // loop can't be seen in the position stream. The notifier must then
    // rely on how long playback has actually been running.
    late StreamController<Duration> position;
    late StreamController<Duration?> duration;
    late StreamController<bool> playing;
    late DateTime clock;
    const trackLength = Duration(minutes: 3);

    setUp(() async {
      position = StreamController<Duration>();
      duration = StreamController<Duration?>();
      playing = StreamController<bool>();
      addTearDown(position.close);
      addTearDown(duration.close);
      addTearDown(playing.close);
      when(() => handler.positionStream).thenAnswer((_) => position.stream);
      when(() => handler.durationStream).thenAnswer((_) => duration.stream);
      when(() => handler.playingStream).thenAnswer((_) => playing.stream);
      clock = DateTime(2026, 1, 1);
      notifier = PlayerNotifier(handler, now: () => clock);
      await notifier.playSong(_song('a'), client, downloads);
      clearInteractions(client);
      duration.add(trackLength);
      playing.add(true);
      await pumpEventQueue();
    });

    /// Plays [wall] of real time, with the reported position stuck at [pos].
    Future<void> listen(Duration wall, {required Duration pos}) async {
      for (var t = Duration.zero;
          t < wall;
          t += const Duration(milliseconds: 200)) {
        clock = clock.add(const Duration(milliseconds: 200));
        position.add(pos);
        await pumpEventQueue();
      }
    }

    test('counts the next lap after a full track length of listening',
        () async {
      position.add(const Duration(seconds: 31));
      await pumpEventQueue();
      verify(() => client.scrobble('a', submission: true)).called(1);

      // lap 1 has 149s left, then 30s into lap 2 -> 179s of listening
      await listen(const Duration(seconds: 178), pos: trackLength);
      verifyNever(() => client.scrobble(any(), submission: true));

      await listen(const Duration(seconds: 3), pos: trackLength);
      verify(() => client.scrobble('a', submission: true)).called(1);
    });

    test('keeps counting one play per further lap, not one per 30 seconds',
        () async {
      position.add(const Duration(seconds: 31));
      await pumpEventQueue();
      verify(() => client.scrobble('a', submission: true)).called(1);

      await listen(const Duration(seconds: 181), pos: trackLength);
      verify(() => client.scrobble('a', submission: true)).called(1);

      // next one only a whole track length later
      await listen(const Duration(seconds: 150), pos: trackLength);
      verifyNever(() => client.scrobble(any(), submission: true));
      await listen(const Duration(seconds: 35), pos: trackLength);
      verify(() => client.scrobble('a', submission: true)).called(1);
    });

    test('time spent paused does not count', () async {
      position.add(const Duration(seconds: 31));
      await pumpEventQueue();
      verify(() => client.scrobble('a', submission: true)).called(1);

      playing.add(false);
      await pumpEventQueue();
      await listen(const Duration(minutes: 10),
          pos: const Duration(seconds: 31));

      verifyNever(() => client.scrobble(any(), submission: true));
    });

    test('a long gap between ticks (app in background) does not count',
        () async {
      position.add(const Duration(seconds: 31));
      await pumpEventQueue();
      verify(() => client.scrobble('a', submission: true)).called(1);

      clock = clock.add(const Duration(minutes: 10));
      position.add(const Duration(seconds: 32));
      await pumpEventQueue();

      verifyNever(() => client.scrobble(any(), submission: true));
    });

    test('skipping forward after the first play does not count another',
        () async {
      position.add(const Duration(seconds: 31));
      await pumpEventQueue();
      verify(() => client.scrobble('a', submission: true)).called(1);

      position.add(const Duration(minutes: 2, seconds: 50));
      await pumpEventQueue();
      await listen(const Duration(seconds: 20),
          pos: const Duration(minutes: 3));

      verifyNever(() => client.scrobble(any(), submission: true));
    });
  });

  group('RiffPlayer Connect hooks', () {
    late _FakeRemote remote;
    late StreamController<Duration> position;
    late StreamController<bool> playing;

    setUp(() {
      remote = _FakeRemote();
      position = StreamController<Duration>();
      playing = StreamController<bool>();
      addTearDown(position.close);
      addTearDown(playing.close);
      when(() => handler.positionStream).thenAnswer((_) => position.stream);
      when(() => handler.playingStream).thenAnswer((_) => playing.stream);
      when(() => handler.play()).thenAnswer((_) async {});
      when(() => handler.pause()).thenAnswer((_) async {});
      when(() => handler.seek(any())).thenAnswer((_) async {});
      when(() => handler.playQueue(any(), any(),
          position: any(named: 'position'),
          autoplay: any(named: 'autoplay'))).thenAnswer((_) async {});
      notifier = PlayerNotifier(handler)..remote = remote;
    });

    group(
        'while another device is playing, the transport actions become commands',
        () {
      test('play, pause, next and previous', () {
        notifier.play();
        notifier.pause();
        notifier.next();
        notifier.previous();

        expect(remote.commands.map((c) => c.$1), [
          CommandType.play,
          CommandType.pause,
          CommandType.next,
          CommandType.previous,
        ]);
        verifyNever(() => handler.play());
        verifyNever(() => handler.pause());
        verifyNever(() => handler.skipToNext());
        verifyNever(() => handler.skipToPrevious());
      });

      test('seek sends milliseconds and shows the new position at once', () {
        notifier.seek(const Duration(seconds: 42, milliseconds: 500));

        expect(remote.commands, [(CommandType.seek, 42500)]);
        expect(notifier.state.position,
            const Duration(seconds: 42, milliseconds: 500));
        verifyNever(() => handler.seek(any()));
      });

      test('acts locally as usual when this device is not just a remote', () {
        remote.isRemote = false;

        notifier.play();
        notifier.pause();
        notifier.next();
        notifier.previous();
        notifier.seek(const Duration(seconds: 5));

        expect(remote.commands, isEmpty);
        verify(() => handler.play()).called(1);
        verify(() => handler.pause()).called(1);
        verify(() => handler.skipToNext()).called(1);
        verify(() => handler.skipToPrevious()).called(1);
        verify(() => handler.seek(const Duration(seconds: 5))).called(1);
      });

      test('pauseLocal silences the local player and is never forwarded', () {
        notifier.pauseLocal();

        verify(() => handler.pause()).called(1);
        expect(remote.commands, isEmpty);
      });
    });

    group('while another device is playing, the queue actions edit its queue',
        () {
      test(
          '"Add to queue" goes to the other device, not this phone\'s own queue',
          () async {
        final a = _song('a');
        await notifier.addToQueue(a, client, downloads);

        expect(remote.adds, [a]);
        expect(notifier.state.queue, isEmpty);
        verifyNever(() => handler.insertAt(any(), any()));
      });

      test('removing and reordering are forwarded with the indexes as shown',
          () async {
        await notifier.removeFromQueue(3);
        await notifier.reorderQueue(2, 5);

        expect(remote.removes, [3]);
        expect(remote.moves, [(2, 5)]);
        verifyNever(() => handler.removeQueueItemAt(any()));
        verifyNever(() => handler.moveQueueItem(any(), any()));
      });

      test('they act locally as usual when this device is the player',
          () async {
        remote.isRemote = false;
        await notifier.addToQueue(_song('a'), client, downloads);

        expect(remote.adds, isEmpty);
        verify(() => handler.insertAt(0, any())).called(1);
      });
    });

    group('addToQueueEnd', () {
      test('puts the song at the very end, after anything queued as "next"',
          () async {
        remote.isRemote = false;
        await notifier.playSong(_song('current'), client, downloads,
            queue: [_song('current'), _song('x'), _song('y')], queueIndex: 0);
        await notifier.addToQueue(
            _song('n'), client, downloads); // goes right after current

        await notifier.addToQueueEnd(_song('end'), client, downloads);

        expect(notifier.state.queue.map((s) => s.id),
            ['current', 'n', 'x', 'y', 'end']);
        verify(() => handler.insertAt(4, any())).called(1);
      });

      test('starts playback from scratch when nothing is queued', () async {
        remote.isRemote = false;
        await notifier.addToQueueEnd(_song('a'), client, downloads);
        expect(notifier.state.queue.map((s) => s.id), ['a']);
        verify(() => handler.insertAt(0, any())).called(1);
      });
    });

    group('volume', () {
      test(
          'starts at full volume and passes what is set to the audio handler, clamped',
          () async {
        when(() => handler.setUserVolume(any())).thenAnswer((_) async {});
        expect(notifier.volume, 1.0);

        await notifier.setVolume(0.4);
        expect(notifier.volume, 0.4);
        verify(() => handler.setUserVolume(0.4)).called(1);

        await notifier.setVolume(5);
        expect(notifier.volume, 1.0);
        await notifier.setVolume(-1);
        expect(notifier.volume, 0.0);
      });

      test('is this phone\'s own volume even while another device plays',
          () async {
        when(() => handler.setUserVolume(any())).thenAnswer((_) async {});
        await notifier.setVolume(0.7);
        expect(remote.volumes,
            isEmpty); // forwarding is the connect notifier\'s job, not setVolume\'s
        verify(() => handler.setUserVolume(0.7)).called(1);
      });
    });

    test(
        'starting a track tells the remote controller (a takeover is on its way)',
        () async {
      await notifier.playSong(_song('a'), client, downloads);
      expect(remote.localStarts, 1);
    });

    group('mirror mode', () {
      void mirror({Song? song, bool isPlaying = true}) =>
          notifier.applyRemoteMirror(
            song: song ?? _song('r'),
            playing: isPlaying,
            position: const Duration(seconds: 10),
            duration: const Duration(seconds: 200),
            repeat: LoopMode.all,
            shuffle: true,
          );

      test('shows the other device\'s playback as a one-track queue', () {
        mirror();

        final s = notifier.state;
        expect(notifier.isMirroring, isTrue);
        expect(s.currentSong?.id, 'r');
        expect((
          s.playing,
          s.position,
          s.duration,
          s.repeatMode,
          s.shuffle
        ), (
          true,
          const Duration(seconds: 10),
          const Duration(seconds: 200),
          LoopMode.all,
          true
        ));
      });

      test('an empty mirror (no song) shows no current song', () {
        notifier.applyRemoteMirror(
          song: null,
          playing: false,
          position: Duration.zero,
          duration: Duration.zero,
          repeat: LoopMode.off,
          shuffle: false,
        );
        expect(notifier.state.currentSong, isNull);
        expect(notifier.state.queue, isEmpty);
      });

      test(
          'events from the silenced local player cannot overwrite what is mirrored',
          () async {
        mirror();

        position.add(const Duration(seconds: 99));
        playing.add(false);
        await pumpEventQueue();

        expect(notifier.state.position, const Duration(seconds: 10));
        expect(notifier.state.playing, isTrue);
      });

      test(
          'leaving the mirror hands the state back to the local player and clears what was shown',
          () async {
        mirror();
        notifier.leaveRemoteMirror();

        expect(notifier.isMirroring, isFalse);
        expect(notifier.state.currentSong, isNull);

        position.add(const Duration(seconds: 7));
        await pumpEventQueue();
        expect(notifier.state.position, const Duration(seconds: 7));
      });

      test(
          'leaving with clear: false keeps what was shown until the local player replaces it',
          () {
        mirror();
        notifier.leaveRemoteMirror(clear: false);

        expect(notifier.isMirroring, isFalse);
        expect(notifier.state.currentSong?.id, 'r');
      });

      test('leaving when not mirroring changes nothing', () {
        notifier.leaveRemoteMirror();
        expect(notifier.isMirroring, isFalse);
      });
    });

    group('restoreQueue (handover from another device)', () {
      final songs = [_song('a'), _song('b'), _song('c')];

      Future<void> restore(
              {int index = 1,
              bool play = true,
              bool counted = false,
              List<Song>? queue}) =>
          notifier.restoreQueue(
            queue ?? songs,
            index,
            const Duration(seconds: 83),
            play: play,
            counted: counted,
            client: client,
            downloads: downloads,
          );

      test('loads the queue at the position and starts playing', () async {
        await restore();

        final s = notifier.state;
        expect(s.queue.map((x) => x.id), ['a', 'b', 'c']);
        expect(s.currentIndex, 1);
        expect(s.position, const Duration(seconds: 83));
        verify(() => handler.playQueue(any(), 1,
            position: const Duration(seconds: 83), autoplay: true)).called(1);
        verify(() => client.scrobble('b', submission: false)).called(1);
      });

      test(
          'with play: false it loads and positions the track without starting it or sending "now playing"',
          () async {
        await restore(play: false);

        verify(() => handler.playQueue(any(), 1,
            position: const Duration(seconds: 83), autoplay: false)).called(1);
        verifyNever(() => client.scrobble(any(), submission: false));
      });

      test('leaves mirror mode', () async {
        notifier.applyRemoteMirror(
          song: _song('r'),
          playing: true,
          position: Duration.zero,
          duration: Duration.zero,
          repeat: LoopMode.off,
          shuffle: false,
        );
        await restore();
        expect(notifier.isMirroring, isFalse);
      });

      test('clamps an out-of-range index and ignores an empty queue', () async {
        await restore(index: 99);
        expect(notifier.state.currentIndex, 2);

        await restore(queue: const []);
        expect(notifier.state.queue.length, 3);
      });

      test('remembers whether the play was already counted', () async {
        expect(notifier.currentPlayCounted, isFalse);

        await restore(counted: true);
        expect(notifier.currentPlayCounted, isTrue);

        await restore(counted: false);
        expect(notifier.currentPlayCounted, isFalse);
      });

      test(
          'a play counted elsewhere is not submitted again when playback passes the threshold here',
          () async {
        await restore(counted: true);
        clearInteractions(client);

        position.add(const Duration(seconds: 90));
        await pumpEventQueue();

        verifyNever(() => client.scrobble(any(), submission: true));
      });

      test(
          'an uncounted play is counted once it passes the threshold, and then reports itself as counted',
          () async {
        await restore(counted: false);
        clearInteractions(client);

        position.add(const Duration(seconds: 90));
        await pumpEventQueue();

        verify(() => client.scrobble('b', submission: true)).called(1);
        expect(notifier.currentPlayCounted, isTrue);
      });
    });

    test('applyModes sets repeat and shuffle on the player', () async {
      await notifier.applyModes(repeat: LoopMode.one, shuffle: true);

      verify(() => handler.setLoopMode(LoopMode.one)).called(1);
      verify(() => handler.setShuffleModeEnabled(true)).called(1);
    });
  });
}
