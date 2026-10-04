import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart' show LoopMode;
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/subsonic.dart' show SavedPlayQueue;
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/connect/connect_api.dart';
import 'package:riffplayer_mobile/connect/connect_models.dart';
import 'package:riffplayer_mobile/connect/connect_notifier.dart';
import 'package:riffplayer_mobile/connect/connect_prefs.dart';
import 'package:riffplayer_mobile/providers/providers.dart';

import '../helpers/mocks.dart';

const me = 'me-device-0001';
const other = 'other-device-01';
const creds =
    Credentials(serverUrl: 'http://srv', username: 'u', password: 'p');

Song song(String id, {String? title, int? duration = 200}) => Song(
      id: id,
      title: title ?? 'Song $id',
      artist: 'Artist',
      artistId: 'ar1',
      album: 'Album',
      albumId: 'al1',
      suffix: 'mp3',
      duration: duration,
    );

Map<String, dynamic> songJson(String id,
        {String? title, int? duration = 200}) =>
    {
      'id': id,
      'title': title ?? 'Song $id',
      'artist': 'Artist',
      'artistId': 'ar1',
      'album': 'Album',
      'albumId': 'al1',
      'suffix': 'mp3',
      'duration': duration,
    };

Map<String, dynamic> deviceJson(String id,
        {String? name,
        bool online = true,
        bool unreachable = false,
        bool active = false}) =>
    {
      'id': id,
      'name': name ?? (id == me ? 'My PC' : 'Phone'),
      'type': 'android',
      'online': online,
      'unreachable': unreachable,
      'active': active,
    };

// ── Fakes ──────────────────────────────────────────────────────────────────────

class FakePrefs implements ConnectPrefs {
  String? id;
  String? name;
  String? model = 'Pixel 8';
  int idSaves = 0;

  @override
  Future<String?> deviceId() async => id;
  @override
  Future<void> saveDeviceId(String v) async {
    id = v;
    idSaves++;
  }

  @override
  Future<String?> deviceName() async => name;
  @override
  Future<void> saveDeviceName(String v) async => name = v;
  @override
  Future<String?> deviceModel() async => model;
}

class FakeConnectApi implements ConnectApi {
  final reports = <StateReport>[];
  final commands = <(CommandType, int?, String?)>[];

  /// The extra arguments of each command in [commands] (phase 2), same order.
  final commandArgs = <CommandArgs?>[];
  final transfers = <(String, String)>[];
  final renames = <(String, String)>[];
  final identities = <DeviceIdentity>[];
  final pollSinces = <int?>[];
  final streams = <StreamController<String>>[];
  final pollQueue = <PollResult>[];

  ReportResult reportResult = ReportResult.ok;
  CommandResult commandResult = CommandResult.sent;
  TransferResult transferResult = TransferResult.ok;
  QueueResult? queue;
  Object? queueError;

  /// Answers handed out one per call before falling back to [queue] (null = "could not be fetched").
  final queueSequence = <QueueResult?>[];
  int queueCalls = 0;

  /// When true, openStream waits until a test completes the attempt by hand.
  bool manualOpen = false;
  final pendingOpens = <Completer<StreamOpen>>[];
  int openStatus = 200;
  Object? openError;
  bool hang = true;
  int openCalls = 0;

  @override
  Future<StreamOpen> openStream(
      DeviceIdentity identity, CancelToken cancel) async {
    openCalls++;
    identities.add(identity);
    if (openError != null) throw openError!;
    if (manualOpen) {
      final c = Completer<StreamOpen>();
      pendingOpens.add(c);
      return c.future;
    }
    if (hang) return Completer<StreamOpen>().future;
    if (openStatus != 200) return StreamOpen(openStatus, null);
    final c = StreamController<String>();
    streams.add(c);
    cancel.whenCancel.then((_) {
      if (!c.isClosed) {
        c.addError(DioException.requestCancelled(
            requestOptions: RequestOptions(), reason: 'cancelled'));
        c.close();
      }
    });
    return StreamOpen(200, c.stream);
  }

  @override
  Future<PollResult> pollOnce(
      DeviceIdentity identity, int? since, CancelToken cancel) async {
    pollSinces.add(since);
    if (pollQueue.isEmpty) return Completer<PollResult>().future;
    return pollQueue.removeAt(0);
  }

  @override
  Future<ReportResult> reportState(StateReport report) async {
    reports.add(report);
    return reportResult;
  }

  @override
  Future<CommandResult> sendCommand(String deviceId, CommandType type,
      {int? positionMs, String? targetDeviceId, CommandArgs? args}) async {
    commands.add((type, positionMs, targetDeviceId));
    commandArgs.add(args);
    return commandResult;
  }

  @override
  Future<TransferResult> transfer(String deviceId, String toDeviceId,
      {bool play = true}) async {
    transfers.add((deviceId, toDeviceId));
    return transferResult;
  }

  @override
  Future<bool> renameDevice(String deviceId, String name) async {
    renames.add((deviceId, name));
    return true;
  }

  @override
  Future<QueueResult?> fetchQueue() async {
    queueCalls++;
    if (queueError != null) throw queueError!;
    if (queueSequence.isNotEmpty) return queueSequence.removeAt(0);
    return queue;
  }
}

/// A real [PlayerNotifier] whose state tests can set directly, as if the audio player had changed it.
class TestPlayer extends PlayerNotifier {
  TestPlayer(super.handler);
  void setPlayerState(PlayerState s) => state = s;
}

class Harness {
  final FakeAsync async;
  final base = DateTime(2026, 1, 1);
  final handler = MockAudioHandler();
  final client = MockSubsonicClient();
  final downloads = MockDownloadService();
  final api = FakeConnectApi();
  final prefs = FakePrefs();
  final messages = <String>[];
  int revoked = 0;
  late final TestPlayer player;
  late final ConnectNotifier connect;

  Harness(this.async, {ConnectTimings timings = const ConnectTimings()}) {
    when(() => handler.positionStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.durationStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.playingStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.currentIndexStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.shuffleModeEnabledStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.loopModeStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.pause()).thenAnswer((_) async {});
    when(() => handler.play()).thenAnswer((_) async {});
    when(() => handler.seek(any())).thenAnswer((_) async {});
    when(() => handler.skipToNext()).thenAnswer((_) async {});
    when(() => handler.skipToPrevious()).thenAnswer((_) async {});
    when(() => handler.setLoopMode(any())).thenAnswer((_) async {});
    when(() => handler.setShuffleModeEnabled(any())).thenAnswer((_) async {});
    when(() => handler.setUserVolume(any())).thenAnswer((_) async {});
    when(() => handler.playQueue(any(), any(),
        position: any(named: 'position'),
        autoplay: any(named: 'autoplay'))).thenAnswer((_) async {});
    when(() => client.getPlayQueue()).thenAnswer((_) async => null);
    when(() => client.savePlayQueue(any(),
        current: any(named: 'current'),
        positionMs: any(named: 'positionMs'))).thenAnswer((_) async {});
    when(() => downloads.localPath(any())).thenAnswer((_) async => null);
    when(() => client.streamUrl(any())).thenReturn('http://test/stream');
    when(() => client.scrobble(any(), submission: any(named: 'submission')))
        .thenAnswer((_) async {});

    player = TestPlayer(handler);
    connect = ConnectNotifier(
      player: player,
      downloads: downloads,
      prefs: prefs,
      onRevoked: () async => revoked++,
      showMessage: messages.add,
      apiFactory: (_) => api,
      clientFactory: (_) => client,
      now: () => base.add(async.elapsed),
      random: () =>
          0.5, // no jitter: reconnect delays are exactly 1 s, 2 s, 4 s...
      timings: timings,
    );
  }

  int get nowMs => base.add(async.elapsed).millisecondsSinceEpoch;
  ConnectState get state => connect.state;

  void tick([Duration d = Duration.zero]) {
    async.elapse(d);
    async.flushMicrotasks();
  }

  /// Starts and (with a hanging server) marks the connection online by hand.
  void startOnline() {
    prefs.id = me;
    prefs.name = 'My PC';
    api.hang = true;
    connect.start(creds);
    tick();
    handle('hello', {'serverTimeMs': nowMs, 'you': me});
  }

  void handle(String name, Object? data) {
    connect.handle(name, data);
    async.flushMicrotasks();
  }

  Map<String, dynamic> remoteJson({
    bool playing = true,
    int positionMs = 10000,
    int? positionAtMs,
    int? durationMs = 200000,
    String repeat = 'off',
    bool shuffle = false,
    Map<String, dynamic>? song,
  }) =>
      {
        'activeDeviceId': other,
        'playing': playing,
        'song': song ?? songJson('r1', title: 'Remote Song'),
        'index': 0,
        'queueLength': 3,
        'queueVersion': 1,
        'positionMs': positionMs,
        'positionAtMs': positionAtMs ?? nowMs,
        'durationMs': durationMs,
        'repeat': repeat,
        'shuffle': shuffle,
        'counted': false,
      };

  /// Snapshot in which `other` is the one playing.
  void otherIsPlaying({Map<String, dynamic>? remote}) {
    handle('snapshot', {
      'devices': [deviceJson(me), deviceJson(other, active: true)],
      'activeDeviceId': other,
      'state': remote ?? remoteJson(),
    });
  }

  void meIsActive() {
    handle('devices', {
      'devices': [deviceJson(me, active: true), deviceJson(other)],
      'activeDeviceId': me,
    });
  }

  void playLocally(
      {int index = 0,
      bool playing = true,
      Duration position = const Duration(milliseconds: 12300),
      List<Song>? queue}) {
    player.setPlayerState(PlayerState(
      queue: queue ?? [song('a'), song('b')],
      currentIndex: index,
      playing: playing,
      position: position,
      duration: const Duration(seconds: 200),
    ));
    async.flushMicrotasks();
  }

  /// Lets [d] pass the way a healthy connection would: the server's heartbeat reaches every open stream.
  void idle(Duration d) {
    var left = d;
    while (left > Duration.zero) {
      final step = left > const Duration(seconds: 20)
          ? const Duration(seconds: 20)
          : left;
      tick(step);
      left -= step;
      for (final c in api.streams) {
        if (!c.isClosed) c.add(': ping\n\n');
      }
    }
    async.flushMicrotasks();
  }

  void dispose() {
    connect.dispose();
    player.dispose();
  }
}

/// A test that runs on virtual time with a ready [Harness].
void fakeTest(String description, void Function(Harness h) body,
    {ConnectTimings timings = const ConnectTimings()}) {
  test(description, () {
    fakeAsync((async) {
      final h = Harness(async, timings: timings);
      body(h);
      h.dispose();
    });
  });
}

String sse(String name, Object data, [int id = 1]) =>
    'id: $id\nevent: $name\ndata: ${jsonEncode(data)}\n\n';

void main() {
  setUpAll(() {
    registerMockFallbackValues();
    registerFallbackValue(Duration.zero);
  });

  // ── Identity ───────────────────────────────────────────────────────────────

  group('identity', () {
    fakeTest(
        'creates and remembers a device id, and names the device after the phone model',
        (h) {
      h.connect.init();
      h.tick();

      expect(h.state.deviceId, startsWith('android-'));
      expect(h.prefs.id, h.state.deviceId);
      expect(h.state.deviceName, 'Pixel 8');
    });

    fakeTest('reuses a stored id and name', (h) {
      h.prefs.id = 'stored-device-id';
      h.prefs.name = 'Kitchen phone';
      h.connect.init();
      h.tick();

      expect((h.state.deviceId, h.state.deviceName),
          ('stored-device-id', 'Kitchen phone'));
      expect(h.prefs.idSaves, 0);
    });

    fakeTest('falls back to a generic name when the model is unknown', (h) {
      h.prefs.model = null;
      h.connect.init();
      h.tick();
      expect(h.state.deviceName, 'Android phone');
    });

    fakeTest(
        'rename trims, caps at 40 characters, remembers it and tells the server',
        (h) {
      h.startOnline();

      h.connect.renameThisDevice('  ${'x' * 60}  ');
      h.tick();

      expect(h.state.deviceName, 'x' * 40);
      expect(h.prefs.name, 'x' * 40);
      expect(h.api.renames, [(me, 'x' * 40)]);
    });

    fakeTest('rename works offline too, and ignores a blank name', (h) {
      h.prefs.id = me;
      h.connect.init();
      h.tick();

      h.connect.renameThisDevice('Kitchen phone');
      h.connect.renameThisDevice('   ');
      h.tick();

      expect(h.state.deviceName, 'Kitchen phone');
      expect(h.api.renames, isEmpty);
    });
  });

  // ── Events → state ─────────────────────────────────────────────────────────

  group('events', () {
    fakeTest('hello marks the device online', (h) {
      h.startOnline();
      expect(h.state.status, ConnectStatus.online);
    });

    fakeTest('snapshot stores devices, the active device and the remote state',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      expect(h.state.devices.map((d) => d.id), [me, other]);
      expect(h.state.activeDeviceId, other);
      expect(h.state.remote?.song?.title, 'Remote Song');
      expect(h.state.remoteActive, isTrue);
      expect(h.state.activeDevice?.name, 'Phone');
    });

    fakeTest('devices and state events update their parts', (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.handle('devices', {
        'devices': [
          deviceJson(me),
          deviceJson(other, name: 'Renamed', active: true)
        ],
        'activeDeviceId': other,
      });
      expect(h.state.devices[1].name, 'Renamed');

      h.handle(
          'state',
          h.remoteJson(
              positionMs: 50000, song: songJson('r2', title: 'Next One')));
      expect(h.state.remote?.song?.title, 'Next One');
    });

    fakeTest('revoked signs the user out', (h) {
      h.startOnline();
      h.handle('revoked', {});
      expect(h.revoked, 1);
    });

    fakeTest(
        'a server error event (e.g. too many devices) marks the connection offline',
        (h) {
      h.startOnline();
      h.handle('error', {'error': 'too_many_devices'});
      expect(h.state.status, ConnectStatus.offline);
    });

    fakeTest('ignores events it does not know, and commands of an unknown type',
        (h) {
      h.startOnline();
      h.handle('from-the-future', {'a': 1});
      h.handle('command', {
        'commandId': 'x',
        'type': 'self-destruct',
        'expiresAtMs': h.nowMs + 5000
      });

      verifyNever(() => h.handler.skipToNext());
    });
  });

  // ── Mirror mode ────────────────────────────────────────────────────────────

  group('mirror mode', () {
    fakeTest(
        'shows what the other device plays through the normal player state and silences the local player',
        (h) {
      h.startOnline();
      h.otherIsPlaying(remote: h.remoteJson(repeat: 'all', shuffle: true));

      final p = h.player.state;
      expect(p.currentSong?.title, 'Remote Song');
      expect(p.playing, isTrue);
      expect(p.position.inSeconds, 10);
      expect(p.duration, const Duration(seconds: 200));
      expect((p.repeatMode, p.shuffle), (LoopMode.all, true));
      expect(p.queue.length, 1);
      expect(h.player.isMirroring, isTrue);
      verify(() => h.handler.pause()).called(1);
    });

    fakeTest(
        'keeps the position moving while the other device plays, and not while it is paused',
        (h) {
      h.startOnline();
      h.otherIsPlaying(remote: h.remoteJson(positionMs: 10000));
      h.tick(const Duration(seconds: 3));
      expect(h.player.state.position.inSeconds, 13);

      h.handle('state', h.remoteJson(playing: false, positionMs: 13000));
      h.tick(const Duration(seconds: 5));
      expect(h.player.state.position.inSeconds, 13);
      expect(h.player.state.playing, isFalse);
    });

    fakeTest('does not run past the end of the track', (h) {
      h.startOnline();
      h.otherIsPlaying(remote: h.remoteJson(positionMs: 199000));
      h.tick(const Duration(seconds: 10));
      expect(h.player.state.position, const Duration(seconds: 200));
    });

    fakeTest('falls back to the song\'s own duration when the report has none',
        (h) {
      h.startOnline();
      h.otherIsPlaying(
          remote: h.remoteJson(
              durationMs: null, song: songJson('r1', duration: 321)));
      expect(h.player.state.duration, const Duration(seconds: 321));
    });

    fakeTest('stops mirroring once this device is the one playing', (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.meIsActive();

      expect(h.player.isMirroring, isFalse);
      h.playLocally();
      h.tick(const Duration(seconds: 3));
      expect(h.player.state.currentSong?.id, 'a');
    });
  });

  // ── Transport actions while only a remote ──────────────────────────────────

  group('controlling the other device', () {
    fakeTest('pause/play go to the other device, and the button flips at once',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.player.pause();
      h.tick();
      expect(h.api.commands.last.$1, CommandType.pause);
      expect(h.player.state.playing, isFalse);
      expect(h.state.remote?.playing, isFalse);

      h.player.play();
      h.tick();
      expect(h.api.commands.last.$1, CommandType.play);
      expect(h.player.state.playing, isTrue);
      verifyNever(() => h.handler.play());
    });

    fakeTest('keeps the shown position steady across an optimistic pause', (h) {
      h.startOnline();
      h.otherIsPlaying(remote: h.remoteJson(positionMs: 10000));
      h.tick(const Duration(seconds: 4));

      h.player.pause();
      h.tick(const Duration(seconds: 1));

      expect(h.player.state.position.inSeconds, 14);
    });

    fakeTest('next and previous go to the other device, not the local player',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.player.next();
      h.player.previous();
      h.tick();

      expect(h.api.commands.map((c) => c.$1),
          [CommandType.next, CommandType.previous]);
      verifyNever(() => h.handler.skipToNext());
      verifyNever(() => h.handler.skipToPrevious());
    });

    fakeTest('a slider drag sends only the position where it comes to rest',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.player.seek(const Duration(seconds: 30));
      h.tick(const Duration(milliseconds: 50));
      h.player.seek(const Duration(seconds: 60));
      h.tick(const Duration(milliseconds: 50));
      h.player.seek(const Duration(seconds: 90));
      expect(h.api.commands, isEmpty);

      h.tick(const Duration(milliseconds: 150));

      expect(h.api.commands, [(CommandType.seek, 90000, other)]);
      verifyNever(() => h.handler.seek(any()));
    });

    fakeTest('names the device it believes is playing in every command', (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.player.next();
      h.player.pause();
      h.tick();
      h.player.seek(const Duration(seconds: 30));
      h.tick(const Duration(milliseconds: 200));

      expect(h.api.commands.map((c) => c.$3), [other, other, other]);
    });

    fakeTest(
        'when another device has taken over since, says so instead of acting on the new one',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.api.commandResult = CommandResult.targetChanged;

      h.player.next();
      h.tick();

      expect(h.messages.last, 'Another device just took over — try again');
    });

    fakeTest(
        'says so when the other device cannot be reached, and when the server cannot',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.api.commandResult = CommandResult.noActiveDevice;
      h.player.next();
      h.tick();
      expect(h.messages.last, "Phone isn't reachable right now");

      h.api.commandResult = CommandResult.error;
      h.player.next();
      h.tick();
      expect(h.messages.last, "Couldn't reach the server");
    });

    fakeTest('acts locally again when this device is the one playing', (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.meIsActive();

      h.player.next();
      h.player.seek(const Duration(seconds: 5));
      h.tick(const Duration(milliseconds: 500));

      expect(h.api.commands, isEmpty);
      verify(() => h.handler.skipToNext()).called(1);
      verify(() => h.handler.seek(const Duration(seconds: 5))).called(1);
    });

    fakeTest('acts locally while the connection is down', (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.handle('error', {'error': 'x'});

      h.player.next();
      h.tick();

      expect(h.api.commands, isEmpty);
      verify(() => h.handler.skipToNext()).called(1);
    });
  });

  // ── Commands executed here ─────────────────────────────────────────────────

  group('commands from another device', () {
    Map<String, dynamic> cmd(Harness h, String type,
            {int? positionMs, int? expiresIn = 5000, String? id}) =>
        {
          'commandId': id ?? 'c-${h.nowMs}-$type',
          'type': type,
          if (positionMs != null) 'positionMs': positionMs,
          'expiresAtMs': h.nowMs + (expiresIn ?? 5000),
        };

    fakeTest('next, previous and seek are executed on the local player', (h) {
      h.startOnline();
      h.handle('command', cmd(h, 'next'));
      h.handle('command', cmd(h, 'previous'));
      h.handle('command', cmd(h, 'seek', positionMs: 42000));

      verify(() => h.handler.skipToNext()).called(1);
      verify(() => h.handler.skipToPrevious()).called(1);
      verify(() => h.handler.seek(const Duration(seconds: 42))).called(1);
    });

    fakeTest(
        'play only starts a paused player and pause only stops a playing one',
        (h) {
      h.startOnline();
      h.playLocally(playing: true);
      h.handle('command', cmd(h, 'play'));
      verifyNever(() => h.handler.play());
      h.handle('command', cmd(h, 'pause'));
      verify(() => h.handler.pause()).called(1);

      h.playLocally(playing: false);
      h.handle('command', cmd(h, 'pause', id: 'p2'));
      verifyNever(() => h.handler.play());
      h.handle('command', cmd(h, 'play', id: 'p3'));
      verify(() => h.handler.play()).called(1);
    });

    fakeTest('runs a command once even if it is delivered twice', (h) {
      h.startOnline();
      final c = cmd(h, 'next');
      h.handle('command', c);
      h.handle('command', c);
      verify(() => h.handler.skipToNext()).called(1);
    });

    fakeTest('ignores a command that has expired', (h) {
      h.startOnline();
      h.handle('command', cmd(h, 'next', expiresIn: -1));
      verifyNever(() => h.handler.skipToNext());
    });

    fakeTest(
        'never forwards a command back out, even if this device already looks like a remote',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.handle('command', cmd(h, 'next'));

      verify(() => h.handler.skipToNext()).called(1);
      expect(h.api.commands, isEmpty);
      expect(h.connect.isRemote, isTrue); // and back to normal afterwards
    });
  });

  // ── Receiving a handover ───────────────────────────────────────────────────

  group('load (handover to this device)', () {
    Map<String, dynamic> load({bool play = true, bool counted = true}) => {
          'queueVersion': 2,
          'index': 1,
          'positionMs': 83000,
          'play': play,
          'counted': counted
        };

    fakeTest(
        'fetches the queue and plays it at the given position, keeping the other device\'s repeat/shuffle',
        (h) {
      h.startOnline();
      h.otherIsPlaying(remote: h.remoteJson(repeat: 'all', shuffle: true));
      h.api.queue = QueueResult(
          queueVersion: 2, index: 1, songs: [song('a'), song('b'), song('c')]);

      h.handle('load', load());
      h.tick();

      verify(() => h.handler.setLoopMode(LoopMode.all)).called(1);
      verify(() => h.handler.setShuffleModeEnabled(true)).called(1);
      verify(() => h.handler.playQueue(any(), 1,
          position: const Duration(seconds: 83), autoplay: true)).called(1);
      expect(h.player.state.queue.map((s) => s.id), ['a', 'b', 'c']);
      expect(h.player.state.currentIndex, 1);
      expect(h.player.isMirroring, isFalse);
    });

    fakeTest(
        'a play the other device already counted is not counted again here',
        (h) {
      h.startOnline();
      h.api.queue =
          QueueResult(queueVersion: 2, index: 1, songs: [song('a'), song('b')]);

      h.handle('load', load(counted: true));
      h.tick();
      expect(h.player.currentPlayCounted, isTrue);

      h.handle('load', load(counted: false));
      h.tick();
      expect(h.player.currentPlayCounted, isFalse);
    });

    fakeTest('loads without playing when the handover says so', (h) {
      h.startOnline();
      h.api.queue = QueueResult(queueVersion: 2, index: 0, songs: [song('a')]);

      h.handle('load', load(play: false));
      h.tick();

      verify(() => h.handler.playQueue(any(), 0,
          position: const Duration(seconds: 83), autoplay: false)).called(1);
      verifyNever(() => h.client.scrobble(any(), submission: false));
    });

    fakeTest('survives a handover whose queue cannot be loaded', (h) {
      h.startOnline();
      h.api.queueError = StateError('boom');

      h.handle('load', load());
      h.tick();

      verifyNever(() => h.handler.playQueue(any(), any(),
          position: any(named: 'position'), autoplay: any(named: 'autoplay')));
    });

    fakeTest('does nothing when the server has no queue to give', (h) {
      h.startOnline();
      h.api.queue = null;

      h.handle('load', load());
      h.tick();

      verifyNever(() => h.handler.playQueue(any(), any(),
          position: any(named: 'position'), autoplay: any(named: 'autoplay')));
    });
  });

  // ── Reporting this device's playback ───────────────────────────────────────

  group('reporting local playback', () {
    fakeTest('reports what is playing, with the whole queue the first time',
        (h) {
      h.startOnline();
      h.playLocally();
      h.tick(const Duration(milliseconds: 250));

      expect(h.api.reports.length, 1);
      final r = h.api.reports.single;
      expect(r.deviceId, me);
      expect(r.queueIds, ['a', 'b']);
      expect((r.index, r.positionMs, r.playing, r.repeat, r.shuffle, r.counted),
          (0, 12300, true, LoopMode.off, false, false));
    });

    fakeTest('leaves the queue out of later reports until it changes', (h) {
      h.startOnline();
      h.playLocally();
      h.tick(const Duration(milliseconds: 250));
      h.playLocally(playing: false, queue: h.player.state.queue);
      h.tick(const Duration(milliseconds: 250));

      expect(h.api.reports[1].playing, isFalse);
      expect(h.api.reports[1].queueIds, isNull);

      h.playLocally(queue: [song('a'), song('b'), song('c')]);
      h.tick(const Duration(milliseconds: 250));
      expect(h.api.reports[2].queueIds, ['a', 'b', 'c']);
    });

    fakeTest('coalesces a burst of changes into one report', (h) {
      h.startOnline();
      final queue = [song('a'), song('b')];
      h.playLocally(queue: queue);
      h.playLocally(index: 1, queue: queue);
      h.playLocally(index: 1, queue: queue, playing: false);
      h.tick(const Duration(milliseconds: 250));

      expect(h.api.reports.length, 1);
      expect((h.api.reports.single.index, h.api.reports.single.playing),
          (1, false));
    });

    fakeTest(
        'resends once with the queue when the server asks for it, and does not loop',
        (h) {
      h.startOnline();
      h.playLocally();
      h.tick(const Duration(milliseconds: 250));
      h.api.reports.clear();
      h.api.reportResult = ReportResult.needQueue;

      h.playLocally(playing: false, queue: h.player.state.queue);
      h.tick(const Duration(milliseconds: 250));

      expect(h.api.reports.length, 2);
      expect(h.api.reports[1].queueIds, ['a', 'b']);
    });

    fakeTest('sends nothing for an empty queue or while the connection is down',
        (h) {
      h.startOnline();
      h.player.setPlayerState(const PlayerState(playing: true));
      h.tick(const Duration(milliseconds: 250));
      expect(h.api.reports, isEmpty);

      h.handle('error', {'error': 'x'});
      h.playLocally();
      h.tick(const Duration(milliseconds: 250));
      expect(h.api.reports, isEmpty);
    });

    fakeTest(
        'a paused bystander stays quiet, but starting playback here takes over from the other device',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.tick(const Duration(seconds: 1));
      expect(h.api.reports,
          isEmpty); // mirroring is not "the user doing something"

      h.connect.onLocalStart();
      h.playLocally(playing: false, queue: [song('a')]);
      h.tick(const Duration(milliseconds: 250));
      expect(h.api.reports, isEmpty);

      h.playLocally(queue: [song('a')]);
      h.tick(const Duration(milliseconds: 250));
      expect(h.api.reports.length, 1);
      expect(h.api.reports.single.playing, isTrue);
      expect(h.api.reports.single.queueIds, ['a']);
    });

    fakeTest('reports a seek, but not ordinary playback progress', (h) {
      h.startOnline();
      h.meIsActive();
      h.playLocally(position: const Duration(seconds: 10));
      h.tick(const Duration(milliseconds: 250));
      h.api.reports.clear();

      final queue =
          h.player.state.queue; // position updates keep the same queue object
      for (var i = 1; i <= 8; i++) {
        h.tick(const Duration(milliseconds: 250));
        h.playLocally(
            position: Duration(milliseconds: 10000 + i * 250), queue: queue);
      }
      h.tick(const Duration(milliseconds: 250));
      expect(h.api.reports, isEmpty);

      h.playLocally(position: const Duration(seconds: 120), queue: queue);
      h.tick(const Duration(milliseconds: 250));
      expect(h.api.reports.length, 1);
      expect(h.api.reports.single.positionMs, 120000);
    });

    fakeTest(
        're-reports every ten seconds while playing here (drift correction), not while paused',
        (h) {
      h.startOnline();
      h.meIsActive();
      h.playLocally();
      h.tick(const Duration(milliseconds: 250));
      h.api.reports.clear();

      h.tick(const Duration(seconds: 10));
      expect(h.api.reports.length, 1);

      h.playLocally(playing: false, queue: h.player.state.queue);
      h.tick(const Duration(milliseconds: 250));
      h.api.reports.clear();
      h.tick(const Duration(seconds: 20));
      expect(h.api.reports, isEmpty);
    });

    fakeTest(
        'never reports another device\'s track back as its own queue (and so never steals playback by accident)',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.tick(const Duration(seconds: 1));

      expect(h.api.reports, isEmpty);
      expect(h.player.state.queue.single.id,
          'r1'); // it is shown, just never reported
    });

    fakeTest(
        'a stale mirrored state is not reported between "the user started a track here" and the player actually starting it',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.connect.onLocalStart();

      // the silenced local player emits a position event while playSong() is still preparing the queue
      h.player.setPlayerState(h.player.state.copyWith(position: Duration.zero));
      h.tick(const Duration(milliseconds: 500));

      expect(h.api.reports, isEmpty);
    });

    fakeTest(
        'does not keep re-reporting a queue it is only mirroring while another device plays',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.tick(const Duration(seconds: 35));

      expect(h.api.reports, isEmpty);
    });

    fakeTest(
        'reports the queue again after a (re)connect, since the server may have restarted',
        (h) {
      h.startOnline();
      h.meIsActive();
      h.playLocally();
      h.tick(const Duration(milliseconds: 250));
      h.api.reports.clear();

      h.handle('snapshot', {
        'devices': [deviceJson(me, active: true)],
        'activeDeviceId': me,
        'state': null
      });
      h.tick();

      expect(h.api.reports.length, 1);
      expect(h.api.reports.single.queueIds, ['a', 'b']);
    });

    fakeTest('gives up cleanly against a server without Connect', (h) {
      h.startOnline();
      h.api.reportResult = ReportResult.unavailable;
      h.playLocally();
      h.tick(const Duration(milliseconds: 250));

      expect(h.state.status, ConnectStatus.unavailable);
      expect(h.player.remote, isNull);
    });
  });

  // ── Takeover ───────────────────────────────────────────────────────────────

  group('taking over from another device', () {
    fakeTest(
        'starting a track here leaves mirror mode, and the mirror does not put the other track back while the takeover is in flight',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      expect(h.player.isMirroring, isTrue);

      h.connect.onLocalStart();
      expect(h.player.isMirroring, isFalse);
      h.playLocally(queue: [song('a')]);

      h.tick(const Duration(seconds: 2));
      expect(h.player.state.currentSong?.id, 'a');
      expect(h.player.isMirroring, isFalse);

      // confirmed: this device is now the active one and mirroring stays off
      h.meIsActive();
      h.tick(const Duration(seconds: 10));
      expect(h.player.state.currentSong?.id, 'a');
    });

    fakeTest(
        'if the takeover is never confirmed (e.g. the player never started) the mirror resumes after a few seconds',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.connect.onLocalStart();
      h.playLocally(queue: [song('a')], playing: false);

      h.tick(const Duration(seconds: 7));
      expect(h.player.state.currentSong?.id, 'a');

      h.tick(const Duration(seconds: 2));
      expect(h.player.state.currentSong?.title, 'Remote Song');
      expect(h.player.isMirroring, isTrue);
    });

    fakeTest(
        'between "the user started a track here" and the player actually setting it up, the mirror stays off',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      // playSong() is still building the queue: nothing local has been set yet
      h.connect.onLocalStart();
      h.tick(const Duration(seconds: 2));

      expect(h.player.isMirroring, isFalse);
    });

    fakeTest('onLocalStart is a no-op when this device is not just a remote',
        (h) {
      h.startOnline();
      h.meIsActive();
      h.playLocally();

      h.connect.onLocalStart();
      h.tick(const Duration(seconds: 2));

      expect(h.player.state.currentSong?.id, 'a');
    });
  });

  // ── Transfer ───────────────────────────────────────────────────────────────

  group('transfer', () {
    fakeTest(
        'transferTo asks the server to move playback from this device to the chosen one',
        (h) {
      h.startOnline();
      h.connect.transferTo(other);
      h.tick();
      expect(h.api.transfers, [(me, other)]);
    });

    fakeTest('transferHere ("Continue here") targets this device', (h) {
      h.startOnline();
      h.connect.transferHere();
      h.tick();
      expect(h.api.transfers, [(me, me)]);
    });

    final explained = {
      TransferResult.targetOffline: 'That device is offline',
      TransferResult.nothingPlaying:
          'Nothing has been played yet — start something first',
      TransferResult.rateLimited: 'Slow down a little',
      TransferResult.error: "Couldn't reach the server",
    };
    explained.forEach((result, message) {
      fakeTest('explains a $result result', (h) {
        h.startOnline();
        h.api.transferResult = result;
        h.connect.transferTo(other);
        h.tick();
        expect(h.messages, [message]);
      });
    });

    for (final result in [
      TransferResult.ok,
      TransferResult.pending,
      TransferResult.noop
    ]) {
      fakeTest('stays quiet on $result', (h) {
        h.startOnline();
        h.api.transferResult = result;
        h.connect.transferTo(other);
        h.tick();
        expect(h.messages, isEmpty);
      });
    }
  });

  // ── The connection itself ──────────────────────────────────────────────────

  group('the connection loop', () {
    String hello(Harness h) =>
        sse('hello', {'serverTimeMs': h.nowMs, 'you': me});

    void begin(Harness h) {
      h.prefs.id = me;
      h.prefs.name = 'My PC';
      h.api.hang = false;
      h.connect.start(creds);
      h.tick();
    }

    fakeTest(
        'opens a stream with this device\'s identity and goes online on hello',
        (h) {
      begin(h);
      expect(h.state.status, ConnectStatus.connecting);
      expect(h.api.identities.single.deviceId, me);
      expect((h.api.identities.single.name, h.api.identities.single.type),
          ('My PC', DeviceType.android));

      h.api.streams[0].add(hello(h));
      h.tick();

      expect(h.state.status, ConnectStatus.online);
    });

    fakeTest('handles events split across network chunks', (h) {
      begin(h);
      final snapshot = sse(
          'snapshot',
          {
            'devices': [deviceJson(me), deviceJson(other)],
            'activeDeviceId': null,
            'state': null
          },
          2);

      h.api.streams[0].add(hello(h));
      h.api.streams[0].add(snapshot.substring(0, 20));
      h.tick();
      expect(h.state.devices, isEmpty);
      h.api.streams[0].add(snapshot.substring(20));
      h.tick();

      expect(h.state.devices.map((d) => d.id), [me, other]);
    });

    fakeTest('stops mirroring when the connection drops', (h) {
      begin(h);
      h.api.streams[0].add(hello(h));
      h.api.streams[0].add(sse(
          'snapshot',
          {
            'devices': [deviceJson(me), deviceJson(other, active: true)],
            'activeDeviceId': other,
            'state': h.remoteJson(),
          },
          2));
      h.tick();
      expect(h.player.isMirroring, isTrue);

      h.api.streams[0].close();
      h.tick();

      expect(h.state.status, ConnectStatus.offline);
      expect(h.player.isMirroring, isFalse);
    });

    fakeTest(
        'registers itself as the remote controller while running and removes itself on stop',
        (h) {
      begin(h);
      expect(h.player.remote, same(h.connect));

      h.connect.stop();

      expect(h.player.remote, isNull);
      expect(h.state.status, ConnectStatus.idle);
      expect(h.state.devices, isEmpty);
    });

    fakeTest(
        'stop cancels the open stream, and starting twice does not open two',
        (h) {
      begin(h);
      h.connect.start(creds);
      h.tick();
      expect(h.api.openCalls, 1);

      h.connect.stop();
      h.tick();

      expect(h.api.streams[0].isClosed, isTrue);
    });

    fakeTest(
        'an older server without /connect hides the feature and stops trying',
        (h) {
      h.api.openStatus = 404;
      begin(h);
      h.tick(const Duration(seconds: 60));

      expect(h.state.status, ConnectStatus.unavailable);
      expect(h.player.remote, isNull);
      expect(h.api.openCalls, 1);
    });

    fakeTest('reconnects after the stream ends, waiting about a second first',
        (h) {
      begin(h);
      h.api.streams[0].add(hello(h));
      h.tick();

      h.api.streams[0].close();
      h.tick();
      expect(h.state.status, ConnectStatus.offline);
      expect(h.api.openCalls, 1);

      h.tick(const Duration(milliseconds: 1300));
      expect(h.api.openCalls, 2);
    });

    fakeTest('backs off further while the server stays unreachable', (h) {
      h.api.openError = DioException(
          requestOptions: RequestOptions(),
          type: DioExceptionType.connectionError);
      begin(h);
      expect(h.api.openCalls, 1);

      h.tick(const Duration(milliseconds: 1300)); // ~1 s
      expect(h.api.openCalls, 2);
      h.tick(const Duration(
          milliseconds: 1300)); // second wait is ~2 s, so nothing yet
      expect(h.api.openCalls, 2);
      h.tick(const Duration(milliseconds: 1500));
      expect(h.api.openCalls, 3);
    });

    fakeTest(
        'after earlier failures, one healthy connection brings the next retry back to about a second',
        (h) {
      h.api.openError = DioException(
          requestOptions: RequestOptions(),
          type: DioExceptionType.connectionError);
      begin(h);
      h.tick(const Duration(milliseconds: 1300));
      h.tick(const Duration(milliseconds: 2600));
      h.api.openError = null;
      h.tick(const Duration(seconds: 5));
      expect(h.api.streams.length, 1);

      h.api.streams[0].add(hello(h));
      for (var i = 0; i < 3; i++) {
        h.tick(const Duration(seconds: 20));
        h.api.streams[0].add(': ping\n\n');
      }
      final calls = h.api.openCalls;
      h.api.streams[0].close();
      h.tick();
      h.tick(const Duration(milliseconds: 1300));

      expect(h.api.openCalls, calls + 1);
    });

    fakeTest(
        'aborts a stream that never says hello, and after two such attempts switches to long-polling',
        (h) {
      begin(h);

      h.tick(const Duration(milliseconds: 8100)); // first silent stream aborted
      expect(h.api.streams[0].isClosed, isTrue);
      expect(h.state.polling, isFalse);

      h.tick(const Duration(milliseconds: 1300)); // reconnects
      expect(h.api.openCalls, 2);
      h.tick(
          const Duration(milliseconds: 8100)); // second silent stream aborted

      expect(h.state.polling, isTrue);
      h.tick(const Duration(milliseconds: 2500));
      expect(h.api.pollSinces, isNotEmpty);
    });

    fakeTest(
        'a stream that goes quiet for 45 seconds (not even heartbeats) is treated as dead',
        (h) {
      begin(h);
      h.api.streams[0].add(hello(h));
      h.tick();

      h.tick(const Duration(seconds: 50));

      expect(h.api.streams[0].isClosed, isTrue);
    });

    fakeTest('heartbeats keep a quiet stream alive', (h) {
      begin(h);
      h.api.streams[0].add(hello(h));
      for (var i = 0; i < 6; i++) {
        h.tick(const Duration(seconds: 20));
        h.api.streams[0].add(': ping\n\n');
      }
      h.tick();

      expect(h.api.streams[0].isClosed, isFalse);
      expect(h.state.status, ConnectStatus.online);
    });

    group('long-poll mode', () {
      PolledEvent ev(int seq, String name, Object data) =>
          PolledEvent(seq, name, data);

      void enterPollMode(Harness h) {
        begin(h);
        h.tick(const Duration(milliseconds: 8100));
        h.tick(const Duration(milliseconds: 1300));
        h.tick(const Duration(milliseconds: 8100));
        expect(h.state.polling, isTrue);
      }

      fakeTest(
          'registers with a first poll and keeps asking for events after the last sequence number it saw',
          (h) {
        h.api.pollQueue.addAll([
          PollResult(200, [
            ev(1, 'hello', {'serverTimeMs': h.nowMs, 'you': me}),
            ev(2, 'snapshot', {
              'devices': [deviceJson(me)],
              'activeDeviceId': null,
              'state': null
            }),
          ]),
          PollResult(200, [
            ev(3, 'devices', {
              'devices': [deviceJson(me), deviceJson(other)],
              'activeDeviceId': null
            }),
          ]),
        ]);

        enterPollMode(h);
        h.tick(const Duration(milliseconds: 2500));

        expect(h.api.pollSinces, [null, 2, 3]);
        expect(h.state.status, ConnectStatus.online);
        expect(h.state.devices.map((d) => d.id), [me, other]);
      });

      fakeTest('a server without /connect ends polling and hides the feature',
          (h) {
        h.api.pollQueue.add(const PollResult(404, []));
        enterPollMode(h);
        h.tick(const Duration(milliseconds: 2500));

        expect(h.state.status, ConnectStatus.unavailable);
      });

      fakeTest(
          'a refused poll (e.g. rate limited) goes offline and is retried later',
          (h) {
        h.api.pollQueue.add(const PollResult(429, []));
        enterPollMode(h);
        h.tick(const Duration(milliseconds: 2500));
        expect(h.state.status, ConnectStatus.offline);
        final first = h.api.pollSinces.length;

        h.tick(const Duration(seconds: 10));
        expect(h.api.pollSinces.length, greaterThan(first));
      });
    });
  });

  // ── Background ─────────────────────────────────────────────────────────────

  group('the app in the background', () {
    void begin(Harness h) {
      h.prefs.id = me;
      h.prefs.name = 'My PC';
      h.api.hang = false;
      h.connect.start(creds);
      h.tick();
      h.api.streams[0].add(sse('hello', {'serverTimeMs': h.nowMs, 'you': me}));
      h.tick();
    }

    fakeTest(
        'a paused phone in the background disconnects after a few minutes, and reconnects on return',
        (h) {
      begin(h);

      h.connect.setForeground(false);
      h.idle(const Duration(minutes: 2));
      expect(h.state.status, ConnectStatus.online);

      h.idle(const Duration(minutes: 2));
      expect(h.state.status, ConnectStatus.idle);
      expect(h.api.streams[0].isClosed, isTrue);

      h.connect.setForeground(true);
      h.tick();
      expect(h.api.openCalls, 2);
      expect(h.state.status, ConnectStatus.connecting);
    });

    fakeTest('stays connected in the background while music plays', (h) {
      begin(h);
      h.playLocally(playing: true);

      h.connect.setForeground(false);
      h.idle(const Duration(minutes: 10));

      expect(h.state.status, ConnectStatus.online);
    });

    fakeTest(
        'starts the countdown when playback stops while in the background, and stops it when playback resumes',
        (h) {
      begin(h);
      h.playLocally(playing: true);
      h.connect.setForeground(false);
      h.idle(const Duration(minutes: 10));

      h.playLocally(playing: false, queue: h.player.state.queue);
      h.idle(const Duration(minutes: 2));
      expect(h.state.status, ConnectStatus.online);

      h.playLocally(playing: true, queue: h.player.state.queue);
      h.idle(const Duration(minutes: 10));
      expect(h.state.status, ConnectStatus.online);

      h.playLocally(playing: false, queue: h.player.state.queue);
      h.idle(const Duration(minutes: 4));
      expect(h.state.status, ConnectStatus.idle);
    });

    fakeTest('coming back before the countdown ends cancels it', (h) {
      begin(h);
      h.connect.setForeground(false);
      h.idle(const Duration(minutes: 2));
      h.connect.setForeground(true);
      h.idle(const Duration(minutes: 10));

      expect(h.state.status, ConnectStatus.online);
      expect(h.api.openCalls, 1);
    });

    fakeTest(
        'a signed-out app is not reconnected when it returns to the foreground',
        (h) {
      begin(h);
      h.connect.setForeground(false);
      h.idle(const Duration(minutes: 4));
      h.connect.stop();

      h.connect.setForeground(true);
      h.tick();

      expect(h.api.openCalls, 1);
    });
  });

  // ── Code review follow-up ──────────────────────────────────────────────────

  group('review: restarting the connection', () {
    fakeTest(
        'stop() followed at once by start() leaves exactly one connection loop (the old one must not wake up and carry on)',
        (h) {
      h.prefs.id = me;
      h.prefs.name = 'My PC';
      h.api.manualOpen = true;

      h.connect.start(creds);
      h.tick();
      h.connect.stop();
      h.connect.start(creds);
      h.tick();
      expect(h.api.openCalls, 2);

      // the first, abandoned attempt now gets an answer: a stream that ends straight away
      final ended = StreamController<String>()..close();
      h.api.pendingOpens[0].complete(StreamOpen(200, ended.stream));
      h.tick(const Duration(seconds: 10));

      expect(h.api.openCalls, 2);
      // ...and it must not have meddled with the new session either (it would mark the connection offline)
      expect(h.state.status, ConnectStatus.connecting);
    });
  });

  group('review: a failed play/pause command', () {
    fakeTest('puts the play/pause button back', (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.api.commandResult = CommandResult.targetChanged;

      h.player.pause(); // optimistic
      expect(h.player.state.playing, isFalse);
      h.tick();

      expect(h.player.state.playing, isTrue);
      expect(h.state.remote?.playing, isTrue);
    });

    fakeTest(
        'does not undo a newer state that arrived while the command was in flight',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.api.commandResult = CommandResult.error;

      h.player.pause();
      h.handle('state', h.remoteJson(playing: false, positionMs: 20000));
      h.tick();

      expect(h.state.remote?.positionMs,
          20000); // the server's state, not the pre-click one
    });
  });

  group('review: a handover whose queue is slow to arrive', () {
    Map<String, dynamic> load() => {
          'queueVersion': 2,
          'index': 0,
          'positionMs': 5000,
          'play': true,
          'counted': false
        };

    fakeTest('retries (the device is already the active one by then)', (h) {
      h.startOnline();
      h.api.queueSequence.addAll([
        null,
        QueueResult(queueVersion: 2, index: 0, songs: [song('a')])
      ]);

      h.handle('load', load());
      h.tick();
      verifyNever(() => h.handler.playQueue(any(), any(),
          position: any(named: 'position'), autoplay: any(named: 'autoplay')));

      h.tick(const Duration(milliseconds: 600));

      verify(() => h.handler.playQueue(any(), 0,
          position: const Duration(seconds: 5), autoplay: true)).called(1);
      expect(h.messages, isEmpty);
    });

    fakeTest(
        'tells the user when the queue cannot be fetched after several tries',
        (h) {
      h.startOnline();
      h.api.queue = null;

      h.handle('load', load());
      h.tick(const Duration(seconds: 5));

      expect(h.api.queueCalls, 3);
      expect(h.messages, ["Couldn't load the queue from the other device"]);
    });
  });

  // ── Resume where you left off ──────────────────────────────────────────────

  group('resume where you left off', () {
    SavedPlayQueue saved({String? current = 'b', DateTime? changed}) =>
        SavedPlayQueue(
          songs: [song('a'), song('b'), song('c')],
          current: current,
          positionMs: 83000,
          changed: changed ?? DateTime(2026, 1, 1),
        );

    void noOneIsPlaying(Harness h) => h.handle('snapshot', {
          'devices': [deviceJson(me)],
          'activeDeviceId': null,
          'state': null
        });

    group('loading', () {
      fakeTest(
          'puts the saved queue back, paused, at the saved song and position — when nothing is playing anywhere',
          (h) {
        h.startOnline();
        when(() => h.client.getPlayQueue()).thenAnswer((_) async => saved());

        noOneIsPlaying(h);
        h.tick();

        verify(() => h.handler.playQueue(any(), 1,
            position: const Duration(seconds: 83), autoplay: false)).called(1);
        expect(h.player.state.queue.map((s) => s.id), ['a', 'b', 'c']);
        expect(h.player.state.currentIndex, 1);
        expect(h.player.state.playing, isFalse);
      });

      fakeTest(
          'starts at the first song when the saved current song is no longer in the queue',
          (h) {
        h.startOnline();
        when(() => h.client.getPlayQueue())
            .thenAnswer((_) async => saved(current: 'gone'));
        noOneIsPlaying(h);
        h.tick();
        verify(() => h.handler.playQueue(any(), 0,
            position: any(named: 'position'), autoplay: false)).called(1);
      });

      fakeTest('does nothing when another device is already playing', (h) {
        h.startOnline();
        when(() => h.client.getPlayQueue()).thenAnswer((_) async => saved());
        h.otherIsPlaying();
        h.tick();

        verifyNever(() => h.client.getPlayQueue());
      });

      fakeTest('does nothing when this device already has a queue', (h) {
        h.startOnline();
        when(() => h.client.getPlayQueue()).thenAnswer((_) async => saved());
        h.playLocally();

        noOneIsPlaying(h);
        h.tick();

        verifyNever(() => h.client.getPlayQueue());
      });

      fakeTest('only tries once per connection session', (h) {
        h.startOnline();
        noOneIsPlaying(h);
        h.tick();
        noOneIsPlaying(h);
        h.tick();

        verify(() => h.client.getPlayQueue()).called(1);
      });

      fakeTest('does nothing when no queue was saved', (h) {
        h.startOnline();
        noOneIsPlaying(h);
        h.tick();
        expect(h.player.state.queue, isEmpty);
      });

      fakeTest('ignores a queue saved more than 30 days ago', (h) {
        h.startOnline();
        final old =
            h.base.add(h.async.elapsed).subtract(const Duration(days: 31));
        when(() => h.client.getPlayQueue())
            .thenAnswer((_) async => saved(changed: old));
        noOneIsPlaying(h);
        h.tick();
        expect(h.player.state.queue, isEmpty);
      });

      fakeTest(
          'does not overwrite something the user started while the saved queue was being fetched',
          (h) {
        h.startOnline();
        final answer = Completer<SavedPlayQueue?>();
        when(() => h.client.getPlayQueue()).thenAnswer((_) => answer.future);

        noOneIsPlaying(h);
        h.playLocally(queue: [song('local')]);
        answer.complete(saved(changed: h.base));
        h.tick();

        verifyNever(() => h.handler.playQueue(any(), any(),
            position: any(named: 'position'),
            autoplay: any(named: 'autoplay')));
        expect(h.player.state.queue.single.id, 'local');
      });

      fakeTest('survives a failing request', (h) {
        h.startOnline();
        when(() => h.client.getPlayQueue())
            .thenAnswer((_) async => throw StateError('offline'));
        noOneIsPlaying(h);
        h.tick();
        expect(h.player.state.queue, isEmpty);
      });

      fakeTest('is tried again after the connection is stopped and started',
          (h) {
        h.startOnline();
        noOneIsPlaying(h);
        h.tick();
        h.connect.stop();
        h.startOnline();
        noOneIsPlaying(h);
        h.tick();

        verify(() => h.client.getPlayQueue()).called(2);
      });
    });

    group('saving', () {
      void play(Harness h,
              {int index = 1,
              bool playing = true,
              double seconds = 12.3,
              List<Song>? queue}) =>
          h.playLocally(
            index: index,
            playing: playing,
            position: Duration(milliseconds: (seconds * 1000).round()),
            queue: queue ?? [song('a'), song('b'), song('c')],
          );

      fakeTest(
          'saves the queue, the current song and the position once this device plays',
          (h) {
        h.startOnline();
        h.meIsActive();
        play(h);
        h.tick(const Duration(milliseconds: 250));

        verify(() => h.client.savePlayQueue(['a', 'b', 'c'],
            current: 'b', positionMs: 12300)).called(1);
      });

      fakeTest(
          'saves at once when playback is paused or the track changes, even right after a save',
          (h) {
        h.startOnline();
        h.meIsActive();
        final queue = [song('a'), song('b'), song('c')];
        play(h, queue: queue);
        h.tick(const Duration(milliseconds: 250));

        play(h, queue: queue, playing: false);
        h.tick(const Duration(milliseconds: 250));
        play(h, queue: queue, index: 2);
        h.tick(const Duration(milliseconds: 250));

        // playing, paused (same song), then the next song: three saves, none held back by the throttle
        verify(() => h.client.savePlayQueue(any(),
            current: 'b', positionMs: any(named: 'positionMs'))).called(2);
        verify(() => h.client.savePlayQueue(any(),
            current: 'c', positionMs: any(named: 'positionMs'))).called(1);
      });

      fakeTest(
          'does not save again for mere playback progress until ten seconds have passed',
          (h) {
        h.startOnline();
        h.meIsActive();
        final queue = [song('a'), song('b'), song('c')];
        play(h, queue: queue);
        h.tick(const Duration(milliseconds: 250));
        h.tick(const Duration(seconds: 9));

        play(h, queue: queue, seconds: 22);
        h.tick(const Duration(seconds: 2)); // the 10 s drift report

        verify(() => h.client.savePlayQueue(['a', 'b', 'c'],
            current: 'b', positionMs: 22000)).called(1);
        verify(() => h.client.savePlayQueue(['a', 'b', 'c'],
            current: 'b', positionMs: 12300)).called(1);
      });

      fakeTest(
          'saves nothing while another device is the one playing, or without a queue, or while offline',
          (h) {
        h.startOnline();
        h.otherIsPlaying();
        h.tick(const Duration(seconds: 11));
        h.meIsActive();
        h.player.setPlayerState(const PlayerState(playing: true));
        h.tick(const Duration(seconds: 11));

        h.handle('error', {'error': 'x'});
        play(h);
        h.tick(const Duration(seconds: 11));

        verifyNever(() => h.client.savePlayQueue(any(),
            current: any(named: 'current'),
            positionMs: any(named: 'positionMs')));
      });

      fakeTest('keeps the saved queue to a window around the current song',
          (h) {
        h.startOnline();
        h.meIsActive();
        final queue = List.generate(800, (i) => song('s$i'));

        play(h, queue: queue, index: 700);
        h.tick(const Duration(milliseconds: 250));
        final first = verify(() => h.client.savePlayQueue(captureAny(),
                current: any(named: 'current'),
                positionMs: any(named: 'positionMs'))).captured.single
            as List<String>;
        expect(first.length, 150); // 650 .. 799
        expect([first.first, first.last], ['s650', 's799']);
        expect(first, contains('s700'));

        play(h, queue: queue, index: 10);
        h.tick(const Duration(milliseconds: 250));
        final second = verify(() => h.client.savePlayQueue(captureAny(),
                current: any(named: 'current'),
                positionMs: any(named: 'positionMs'))).captured.single
            as List<String>;
        expect(second.length, 500);
        expect(second.first, 's0');
        expect(second, contains('s10'));
      });

      fakeTest('survives a failing save', (h) {
        h.startOnline();
        h.meIsActive();
        when(() => h.client.savePlayQueue(any(),
                current: any(named: 'current'),
                positionMs: any(named: 'positionMs')))
            .thenAnswer((_) async => throw StateError('offline'));

        play(h);
        h.tick(const Duration(milliseconds: 250));

        expect(h.state.status, ConnectStatus.online);
      });

      fakeTest('does not immediately write back the queue it just restored',
          (h) {
        h.startOnline();
        when(() => h.client.getPlayQueue()).thenAnswer((_) async =>
            SavedPlayQueue(
                songs: [song('a'), song('b'), song('c')],
                current: 'b',
                positionMs: 83000,
                changed: h.base));

        h.handle('snapshot', {
          'devices': [deviceJson(me)],
          'activeDeviceId': null,
          'state': null
        });
        h.tick(const Duration(seconds: 1));

        verifyNever(() => h.client.savePlayQueue(any(),
            current: any(named: 'current'),
            positionMs: any(named: 'positionMs')));
      });
    });
  });

  // ── Phase 2: the other device's volume and queue ───────────────────────────

  group('remote volume', () {
    Map<String, dynamic> withVolume(Harness h, double v) =>
        {...h.remoteJson(), 'volume': v};

    fakeTest(
        'the slider drives the other device\'s volume and shows it at once, leaving this phone\'s own alone',
        (h) {
      h.startOnline();
      h.otherIsPlaying(remote: withVolume(h, 0.6));
      expect(h.connect.volume, 0.6);

      h.player.setVolume(0.9); // this phone's own player volume (not forwarded)
      h.connect.setVolume(0.3);
      h.tick();

      expect(h.api.commands.last, (CommandType.volume, null, other));
      expect(h.api.commandArgs.last?.volume, 0.3);
      expect(h.state.remote?.volume, 0.3);
      expect(h.player.volume, 0.9);
    });

    fakeTest(
        'a drag goes out at a steady pace and always ends with the final value',
        (h) {
      h.startOnline();
      h.otherIsPlaying(remote: withVolume(h, 0.6));

      for (final v in [0.1, 0.2, 0.3, 0.4]) {
        h.connect.setVolume(v);
      }
      h.tick();
      expect(h.api.commands.length, 1); // the first value goes out at once
      expect(h.api.commandArgs.last?.volume, 0.1);

      h.tick(const Duration(milliseconds: 150));
      expect(h.api.commands.length, 2);
      expect(h.api.commandArgs.last?.volume, 0.4); // not 0.2 / 0.3

      h.tick(const Duration(seconds: 1));
      expect(h.api.commands.length, 2); // nothing is sent twice
    });

    fakeTest('clamps to 0..1', (h) {
      h.startOnline();
      h.otherIsPlaying(remote: withVolume(h, 0.6));
      h.connect.setVolume(7);
      h.tick();
      expect(h.api.commandArgs.last?.volume, 1.0);
    });

    fakeTest(
        'a state report about the old value does not drag the slider back, a later one does',
        (h) {
      h.startOnline();
      h.otherIsPlaying(remote: withVolume(h, 0.6));
      h.connect.setVolume(0.2);
      h.tick();

      h.handle('state',
          withVolume(h, 0.6)); // generated before the device heard about it
      expect(h.state.remote?.volume, 0.2);

      h.tick(const Duration(seconds: 2));
      h.handle('state', withVolume(h, 0.5));
      expect(h.state.remote?.volume, 0.5);
    });

    fakeTest('full volume from a server that does not report one', (h) {
      h.startOnline();
      h.otherIsPlaying();
      expect(h.connect.volume, 1.0);
    });

    fakeTest(
        'is applied to this phone\'s player when another device asks, and reported back',
        (h) {
      h.startOnline();
      h.playLocally();
      h.meIsActive();
      h.tick(const Duration(seconds: 1));
      h.api.reports.clear();

      h.handle('command', {
        'commandId': 'v1',
        'type': 'volume',
        'volume': 0.35,
        'expiresAtMs': h.nowMs + 5000,
      });
      h.tick(const Duration(milliseconds: 300));

      verify(() => h.handler.setUserVolume(0.35)).called(1);
      expect(h.player.volume, 0.35);
      expect(h.api.reports.last.volume, 0.35);
    });

    fakeTest('ignores a volume command without a usable value', (h) {
      h.startOnline();
      h.handle('command', {
        'commandId': 'v1',
        'type': 'volume',
        'expiresAtMs': h.nowMs + 5000,
      });
      h.handle('command', {
        'commandId': 'v2',
        'type': 'volume',
        'volume': 'loud',
        'expiresAtMs': h.nowMs + 5000,
      });
      verifyNever(() => h.handler.setUserVolume(any()));
    });
  });

  group('the other device\'s queue', () {
    QueueResult queueOf(List<String> ids,
            {int version = 1, int index = 0, List<int>? positions}) =>
        QueueResult(
            queueVersion: version,
            index: index,
            songs: ids.map((id) => song(id)).toList(),
            positions: positions);

    Map<String, dynamic> remote(Harness h, {int version = 1, int index = 1}) =>
        {...h.remoteJson(), 'queueVersion': version, 'index': index};

    void setUpQueue(Harness h,
        {List<String> ids = const ['a', 'b', 'c', 'd'], List<int>? positions}) {
      h.startOnline();
      h.api.queue = queueOf(ids, positions: positions);
      h.otherIsPlaying(remote: remote(h));
    }

    fakeTest(
        'is fetched only while someone watches, and the current song follows the device\'s index',
        (h) {
      setUpQueue(h);
      expect(h.api.queueCalls, 0);
      expect(h.state.remoteQueue, isNull);

      final stop = h.connect.watchRemoteQueue();
      h.tick();
      expect(h.api.queueCalls, 1);
      expect(h.state.remoteQueue?.songs.map((s) => s.id), ['a', 'b', 'c', 'd']);
      expect(h.state.remoteQueue?.index,
          1); // from the state, not the fetch (which said 0)

      h.handle('state', remote(h, index: 3));
      expect(h.state.remoteQueue?.index, 3);
      expect(h.api.queueCalls, 1); // a new current song needs no refetch
      stop();
    });

    fakeTest(
        'is fetched again when the queue itself changes, but not when a report repeats the same version',
        (h) {
      setUpQueue(h);
      final stop = h.connect.watchRemoteQueue();
      h.tick();
      h.api.queue = queueOf(['a', 'b', 'x', 'c', 'd'], version: 2);

      h.handle('state', remote(h));
      h.tick();
      expect(h.api.queueCalls, 1);

      h.handle('state', remote(h, version: 2));
      h.tick();
      expect(h.api.queueCalls, 2);
      expect(h.state.remoteQueue?.songs.length, 5);
      stop();
    });

    fakeTest(
        'stops fetching when the last watcher leaves, and drops the view when this phone plays again',
        (h) {
      setUpQueue(h);
      final stop = h.connect.watchRemoteQueue();
      h.tick();
      stop();
      stop(); // stopping twice must not unbalance the count
      h.handle('state', remote(h, version: 2));
      h.tick();
      expect(h.api.queueCalls, 1);

      final again = h.connect.watchRemoteQueue();
      h.tick();
      expect(h.state.remoteQueue, isNotNull);
      h.meIsActive();
      expect(h.state.remoteQueue, isNull);
      again();
    });

    fakeTest('a failing server is asked once per state event, never in a loop',
        (h) {
      setUpQueue(h);
      h.api.queue = null;
      final stop = h.connect.watchRemoteQueue();
      h.tick(const Duration(seconds: 5));
      expect(h.api.queueCalls, 1);
      expect(h.state.remoteQueue, isNull);

      h.api.queue = queueOf(['a', 'b']);
      h.handle('state', remote(h));
      h.tick();
      expect(h.state.remoteQueue?.songs.length, 2);
      stop();
    });

    fakeTest('a throwing fetch is survived', (h) {
      setUpQueue(h);
      h.api.queueError = StateError('boom');
      final stop = h.connect.watchRemoteQueue();
      h.tick(const Duration(seconds: 5));
      expect(h.api.queueCalls, 1);
      expect(h.state.remoteQueue, isNull);
      stop();
    });

    fakeTest(
        'a view already ahead of the last state does not turn into a request loop',
        (h) {
      setUpQueue(h);
      h.api.queue = queueOf(['a', 'b', 'c', 'd'], version: 1);
      h.handle('state',
          remote(h, version: 3)); // behind: the server keeps answering "1"
      final stop = h.connect.watchRemoteQueue();
      h.tick(const Duration(seconds: 5));
      expect(h.api.queueCalls,
          lessThanOrEqualTo(2)); // the fetch and at most one look-again
      stop();
    });

    fakeTest('removing sends the real position and id, and shows it at once',
        (h) {
      setUpQueue(h);
      final stop = h.connect.watchRemoteQueue();
      h.tick();

      h.player.removeFromQueue(2); // forwarded: this phone is only a remote
      h.tick();

      expect(h.api.commands.last, (CommandType.queueRemove, null, other));
      expect((h.api.commandArgs.last?.index, h.api.commandArgs.last?.songId),
          (2, 'c'));
      expect(h.state.remoteQueue?.songs.map((s) => s.id), ['a', 'b', 'd']);
      verifyNever(() => h.handler.removeQueueItemAt(any()));
      stop();
    });

    fakeTest(
        'a library that dropped some ids: edits use the real positions, not the shown ones',
        (h) {
      setUpQueue(h, ids: ['a', 'c', 'd'], positions: [0, 2, 3]);
      final stop = h.connect.watchRemoteQueue();
      h.tick();

      h.player
          .removeFromQueue(1); // "c" is shown 2nd but sits at real position 2
      h.tick();
      expect((h.api.commandArgs.last?.index, h.api.commandArgs.last?.songId),
          (2, 'c'));
      stop();
    });

    fakeTest('reordering is sent from/to in real positions and shown at once',
        (h) {
      setUpQueue(h);
      final stop = h.connect.watchRemoteQueue();
      h.tick();

      h.player.reorderQueue(0, 3);
      h.tick();

      expect(h.api.commands.last, (CommandType.queueMove, null, other));
      final a = h.api.commandArgs.last!;
      expect((a.index, a.to, a.songId), (0, 3, 'a'));
      expect(h.state.remoteQueue?.songs.map((s) => s.id), ['b', 'c', 'd', 'a']);
      expect(h.state.remoteQueue?.index,
          0); // the playing "b" moved up with the list
      verifyNever(() => h.handler.moveQueueItem(any(), any()));
      stop();
    });

    fakeTest('playing a queue item jumps there on the other device', (h) {
      setUpQueue(h);
      final stop = h.connect.watchRemoteQueue();
      h.tick();
      h.connect.playRemoteQueueItem(3);
      h.tick();
      expect(h.api.commands.last, (CommandType.queuePlay, null, other));
      expect((h.api.commandArgs.last?.index, h.api.commandArgs.last?.songId),
          (3, 'd'));
      stop();
    });

    fakeTest('edits nothing when the queue is not loaded or the index is stale',
        (h) {
      setUpQueue(h);
      h.player.removeFromQueue(0); // not watching: no view
      h.player.reorderQueue(0, 1);
      h.connect.playRemoteQueueItem(0);
      final stop = h.connect.watchRemoteQueue();
      h.tick();
      final before = h.api.commands.length;
      h.player.removeFromQueue(9);
      h.player.reorderQueue(0, 9);
      h.connect.playRemoteQueueItem(9);
      h.tick();
      expect(h.api.commands.length, before);
      stop();
    });
  });

  group('adding to the other device\'s queue', () {
    fakeTest(
        '"Add to queue" reaches the other device instead of this phone\'s own queue',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      h.player.addToQueue(song('x'), h.client, h.downloads);
      h.tick(const Duration(milliseconds: 100));

      expect(h.api.commands.last, (CommandType.queueAdd, null, other));
      expect(h.api.commandArgs.last?.mode, QueueAddMode.next);
      expect(h.api.commandArgs.last?.songIds, ['x']);
      verifyNever(() => h.handler.insertAt(any(), any()));
      expect(h.messages.last, '1 song will play next on Phone');
    });

    fakeTest(
        'songs added in quick succession are one command, in the order added',
        (h) {
      h.startOnline();
      h.otherIsPlaying();

      for (final id in ['s1', 's2', 's3']) {
        h.player.addToQueue(song(id), h.client, h.downloads);
      }
      h.tick(const Duration(milliseconds: 100));

      expect(h.api.commands.length, 1);
      expect(h.api.commandArgs.last?.songIds, ['s1', 's2', 's3']);
      expect(h.messages.last, '3 songs will play next on Phone');
    });

    fakeTest('very large additions are split into commands the server accepts',
        (h) {
      h.startOnline();
      h.otherIsPlaying();
      for (var i = 0; i < 230; i++) {
        h.player.addToQueue(song('s$i'), h.client, h.downloads);
      }
      h.tick(const Duration(milliseconds: 100));

      expect(h.api.commandArgs.map((a) => a?.songIds?.length), [100, 100, 30]);
      expect(h.api.commandArgs.expand((a) => a!.songIds!).toList(),
          [for (var i = 0; i < 230; i++) 's$i']);
    });

    fakeTest('does not claim success when the command was not delivered', (h) {
      h.startOnline();
      h.otherIsPlaying();
      h.api.commandResult = CommandResult.noActiveDevice;
      h.player.addToQueue(song('x'), h.client, h.downloads);
      h.tick(const Duration(milliseconds: 100));
      expect(h.messages.last, contains("isn't reachable"));
      expect(h.messages.where((m) => m.contains('will play next')), isEmpty);
    });
  });

  group('queue commands executed on this phone', () {
    Map<String, dynamic> cmd(Harness h, String type, Map<String, dynamic> more,
            {String? id}) =>
        {
          'commandId': id ?? 'q-${h.nowMs}-$type-${more.hashCode}',
          'type': type,
          'expiresAtMs': h.nowMs + 5000,
          ...more,
        };

    void stubQueueOps(Harness h) {
      when(() => h.handler.insertAt(any(), any())).thenAnswer((_) async {});
      when(() => h.handler.removeQueueItemAt(any())).thenAnswer((_) async {});
      when(() => h.handler.moveQueueItem(any(), any()))
          .thenAnswer((_) async {});
      when(() => h.handler.playFromIndex(any())).thenAnswer((_) async {});
    }

    void playing(Harness h) {
      stubQueueOps(h);
      h.startOnline();
      h.playLocally(index: 1, queue: [
        for (final id in ['a', 'b', 'c', 'd']) song(id)
      ]);
    }

    fakeTest('queue_remove removes the named song', (h) {
      playing(h);
      h.handle('command', cmd(h, 'queue_remove', {'index': 3, 'songId': 'd'}));
      verify(() => h.handler.removeQueueItemAt(3)).called(1);
    });

    fakeTest(
        'queue_remove is dropped when the song at that index is not the one the sender saw',
        (h) {
      playing(h);
      h.handle('command', cmd(h, 'queue_remove', {'index': 3, 'songId': 'c'}));
      h.handle('command', cmd(h, 'queue_remove', {'index': 9, 'songId': 'c'}));
      verifyNever(() => h.handler.removeQueueItemAt(any()));
    });

    fakeTest('queue_remove never removes the song that is playing', (h) {
      playing(h);
      h.handle('command', cmd(h, 'queue_remove', {'index': 1, 'songId': 'b'}));
      verifyNever(() => h.handler.removeQueueItemAt(any()));
    });

    fakeTest('queue_move moves the named song', (h) {
      playing(h);
      h.handle('command',
          cmd(h, 'queue_move', {'index': 0, 'to': 3, 'songId': 'a'}));
      verify(() => h.handler.moveQueueItem(0, 3)).called(1);
    });

    fakeTest(
        'queue_move is dropped for a stale index or a destination outside the queue',
        (h) {
      playing(h);
      h.handle('command',
          cmd(h, 'queue_move', {'index': 0, 'to': 3, 'songId': 'zzz'}));
      h.handle('command',
          cmd(h, 'queue_move', {'index': 0, 'to': 9, 'songId': 'a'}));
      h.handle('command',
          cmd(h, 'queue_move', {'index': 0, 'to': -1, 'songId': 'a'}));
      verifyNever(() => h.handler.moveQueueItem(any(), any()));
    });

    fakeTest('queue_play jumps to the named song', (h) {
      playing(h);
      h.handle('command', cmd(h, 'queue_play', {'index': 3, 'songId': 'd'}));
      verify(() => h.handler.playFromIndex(3)).called(1);
    });

    fakeTest('queue_play is dropped for a stale index', (h) {
      playing(h);
      h.handle('command', cmd(h, 'queue_play', {'index': 3, 'songId': 'a'}));
      h.handle('command', cmd(h, 'queue_play', {'index': 9, 'songId': 'd'}));
      verifyNever(() => h.handler.playFromIndex(any()));
    });

    fakeTest(
        'queue_add "next" queues the block after the current song, in order',
        (h) {
      playing(h);
      h.handle(
          'command',
          cmd(h, 'queue_add', {
            'mode': 'next',
            'songs': [songJson('n1'), songJson('n2')],
          }));
      h.tick();
      // current is index 1: n1 goes right after it, n2 after n1
      verify(() => h.handler.insertAt(2, any())).called(1);
      verify(() => h.handler.insertAt(3, any())).called(1);
      expect(h.player.state.queue.map((s) => s.id),
          ['a', 'b', 'n1', 'n2', 'c', 'd']);
    });

    fakeTest('queue_add "end" appends to the very end', (h) {
      playing(h);
      h.handle(
          'command',
          cmd(h, 'queue_add', {
            'mode': 'end',
            'songs': [songJson('x'), songJson('y')],
          }));
      h.tick();
      verify(() => h.handler.insertAt(4, any())).called(1);
      verify(() => h.handler.insertAt(5, any())).called(1);
      expect(h.player.state.queue.map((s) => s.id),
          ['a', 'b', 'c', 'd', 'x', 'y']);
    });

    fakeTest('queue_add without a known mode does nothing', (h) {
      playing(h);
      h.handle(
          'command',
          cmd(h, 'queue_add', {
            'mode': 'sideways',
            'songs': [songJson('no')],
          }));
      h.tick();
      verifyNever(() => h.handler.insertAt(any(), any()));
    });

    fakeTest(
        'the edited queue is reported, so the other devices see the new version',
        (h) {
      playing(h);
      h.meIsActive();
      h.tick(const Duration(seconds: 1));
      h.api.reports.clear();
      h.handle(
          'command',
          cmd(h, 'queue_add', {
            'mode': 'end',
            'songs': [songJson('x')],
          }));
      h.tick(const Duration(milliseconds: 500));
      expect(h.api.reports.last.queueIds, ['a', 'b', 'c', 'd', 'x']);
    });
  });
}
