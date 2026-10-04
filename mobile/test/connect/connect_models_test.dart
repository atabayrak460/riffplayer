import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart' show LoopMode;
import 'package:riffplayer_mobile/connect/connect_models.dart';

SseEvent ev(String name, Object? data, [int? id]) => SseEvent(name, data, id);

PublicState state({
  bool playing = true,
  int positionMs = 10000,
  int positionAtMs = 1000000,
  int? durationMs = 200000,
}) =>
    PublicState(
      activeDeviceId: 'a',
      playing: playing,
      song: null,
      index: 0,
      queueLength: 1,
      queueVersion: 1,
      positionMs: positionMs,
      positionAtMs: positionAtMs,
      durationMs: durationMs,
      repeat: LoopMode.off,
      shuffle: false,
      counted: false,
    );

void main() {
  group('SseParser', () {
    test('parses a complete event with id, name and JSON data', () {
      final items =
          SseParser().push('id: 7\nevent: state\ndata: {"playing":true}\n\n');
      expect(items, [
        ev('state', {'playing': true}, 7)
      ]);
    });

    test('returns several events from one chunk, in order', () {
      final items =
          SseParser().push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n');
      expect(items, [ev('a', 1), ev('b', 2)]);
    });

    test(
        'holds back an incomplete event until the rest arrives, wherever the chunk boundary falls',
        () {
      const text = 'id: 1\nevent: devices\ndata: {"a":[1,2,3]}\n\n';
      for (var cut = 1; cut < text.length; cut++) {
        final parser = SseParser();
        final items = [
          ...parser.push(text.substring(0, cut)),
          ...parser.push(text.substring(cut))
        ];
        expect(
            items,
            [
              ev(
                  'devices',
                  {
                    'a': [1, 2, 3]
                  },
                  1)
            ],
            reason: 'cut at $cut');
      }
    });

    test(
        'reports heartbeat comments (they are how the client knows the connection is alive)',
        () {
      final items = SseParser().push(': ping\n\n');
      expect(items.single, isA<SseComment>());
    });

    test('ignores the retry line and unknown fields', () {
      expect(SseParser().push('retry: 3000\n\nevent: x\nfoo: bar\ndata: 5\n\n'),
          [ev('x', 5)]);
    });

    test('understands CRLF line endings', () {
      expect(SseParser().push('event: x\r\ndata: 1\r\n\r\n'), [ev('x', 1)]);
    });

    test('joins multi-line data with newlines before parsing', () {
      expect(SseParser().push('event: x\ndata: {"a":\ndata: 1}\n\n'), [
        ev('x', {'a': 1})
      ]);
    });

    test('drops a malformed event without breaking the ones after it', () {
      expect(
          SseParser().push('event: bad\ndata: {oops\n\nevent: ok\ndata: 1\n\n'),
          [ev('ok', 1)]);
    });

    test('drops an event with no name or no data', () {
      expect(SseParser().push('data: 1\n\nevent: only-name\n\n'), isEmpty);
    });

    test('only accepts a numeric id', () {
      expect(SseParser().push('id: abc\nevent: x\ndata: 1\n\n'), [ev('x', 1)]);
    });

    test('strips a single leading space from values, not more', () {
      expect(
          SseParser().push('event:  x\ndata:  "  y"\n\n'), [ev(' x', '  y')]);
    });
  });

  group('positionNowMs', () {
    test('advances a playing track by the time passed since the report', () {
      expect(positionNowMs(state(), 1004000), 14000);
    });

    test('does not move a paused track', () {
      expect(positionNowMs(state(playing: false), 1060000), 10000);
    });

    test('never goes past the end of the track', () {
      expect(positionNowMs(state(positionMs: 199000), 1500000), 200000);
    });

    test('does not run backwards if the clocks are slightly off', () {
      expect(positionNowMs(state(), 999000), 10000);
    });

    test('works without a known duration', () {
      expect(positionNowMs(state(durationMs: null), 1005000), 15000);
    });
  });

  group('backoff', () {
    test('doubles from one second and caps at thirty', () {
      final delays = [0, 1, 2, 3, 4, 5, 6, 10]
          .map((n) => backoff(n, () => 0.5).inMilliseconds)
          .toList();
      expect(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    });

    test('jitters by at most ±20%', () {
      expect(backoff(2, () => 0).inMilliseconds, 3200);
      expect(backoff(2, () => 1).inMilliseconds, 4800);
    });

    test('treats a negative attempt like the first', () {
      expect(backoff(-3, () => 0.5).inMilliseconds, 1000);
    });
  });

  group('device identity', () {
    test('defaultDeviceName uses the model, or a generic name when unknown',
        () {
      expect(defaultDeviceName('Pixel 8'), 'Pixel 8');
      expect(defaultDeviceName('  POCO 25053PC47G '), 'POCO 25053PC47G');
      expect(defaultDeviceName(null), 'Android phone');
      expect(defaultDeviceName('   '), 'Android phone');
    });

    test(
        'newDeviceId fits the server\'s device-id format and differs every time',
        () {
      final ids = {for (var i = 0; i < 50; i++) newDeviceId()};
      expect(ids.length, 50);
      for (final id in ids) {
        expect(RegExp(r'^[A-Za-z0-9_-]{8,64}$').hasMatch(id), isTrue,
            reason: id);
      }
    });

    test('newDeviceId is deterministic for a seeded random', () {
      expect(newDeviceId(Random(1)), newDeviceId(Random(1)));
    });
  });

  group('loop mode on the wire', () {
    test('round-trips and defaults to off', () {
      for (final m in LoopMode.values) {
        expect(loopModeFromWire(loopModeToWire(m)), m);
      }
      expect(loopModeFromWire(null), LoopMode.off);
      expect(loopModeFromWire('nonsense'), LoopMode.off);
    });
  });

  group('models from JSON', () {
    Map<String, dynamic> songJson() => {
          'id': 's1',
          'title': 'Karma Police',
          'artist': 'Radiohead',
          'artistId': 'ar1',
          'album': 'OK Computer',
          'albumId': 'al1',
          'suffix': 'mp3',
          'duration': 264,
        };

    test(
        'DeviceInfo, with sensible defaults for missing fields and unknown device types',
        () {
      final d = DeviceInfo.fromJson({
        'id': 'x',
        'name': 'Pixel',
        'type': 'android',
        'online': false,
        'unreachable': true,
        'active': true
      });
      expect((d.id, d.name, d.type, d.online, d.unreachable, d.active),
          ('x', 'Pixel', DeviceType.android, false, true, true));

      final minimal =
          DeviceInfo.fromJson({'id': 'y', 'name': 'Old', 'type': 'toaster'});
      expect(
          (minimal.type, minimal.online, minimal.unreachable, minimal.active),
          (DeviceType.web, true, false, false));
    });

    test('PublicState with its song, repeat mode and numbers', () {
      final s = PublicState.fromJson({
        'activeDeviceId': 'a',
        'playing': true,
        'song': songJson(),
        'index': 2,
        'queueLength': 9,
        'queueVersion': 3,
        'positionMs': 1500,
        'positionAtMs': 1790000000000,
        'durationMs': 264000,
        'repeat': 'one',
        'shuffle': true,
        'counted': true,
      });
      expect(s.song?.title, 'Karma Police');
      expect((
        s.index,
        s.queueLength,
        s.queueVersion,
        s.positionMs,
        s.positionAtMs,
        s.durationMs
      ), (
        2,
        9,
        3,
        1500,
        1790000000000,
        264000
      ));
      expect((s.repeat, s.shuffle, s.counted, s.playing),
          (LoopMode.one, true, true, true));
    });

    test('PublicState tolerates a missing song and duration', () {
      final s = PublicState.fromJson(
          {'activeDeviceId': 'a', 'song': null, 'durationMs': null});
      expect(s.song, isNull);
      expect(s.durationMs, isNull);
      expect(s.playing, isFalse);
    });

    test('PublicState.copyWith changes only what it is given', () {
      final s = state().copyWith(playing: false, positionMs: 5);
      expect((s.playing, s.positionMs, s.positionAtMs, s.durationMs),
          (false, 5, 1000000, 200000));
    });

    test('Snapshot with and without playback', () {
      final empty = Snapshot.fromJson(
          {'devices': [], 'activeDeviceId': null, 'state': null});
      expect(empty.devices, isEmpty);
      expect(empty.activeDeviceId, isNull);
      expect(empty.state, isNull);

      final full = Snapshot.fromJson({
        'devices': [
          {'id': 'a', 'name': 'A', 'type': 'web'}
        ],
        'activeDeviceId': 'a',
        'state': {'activeDeviceId': 'a', 'song': songJson()},
      });
      expect(full.devices.single.id, 'a');
      expect(full.state?.song?.id, 's1');
    });

    test('LoadInstruction and QueueResult', () {
      final l = LoadInstruction.fromJson({
        'queueVersion': 2,
        'index': 1,
        'positionMs': 83000,
        'play': false,
        'counted': true
      });
      expect((l.queueVersion, l.index, l.positionMs, l.play, l.counted),
          (2, 1, 83000, false, true));

      final q = QueueResult.fromJson({
        'queueVersion': 2,
        'index': 1,
        'songs': [songJson(), songJson()]
      });
      expect((q.queueVersion, q.index, q.songs.length), (2, 1, 2));
    });

    test(
        'CommandInstruction.tryParse returns null for a command this client does not know',
        () {
      final ok = CommandInstruction.tryParse({
        'commandId': 'c1',
        'type': 'seek',
        'positionMs': 42000,
        'expiresAtMs': 9
      });
      expect((ok?.type, ok?.positionMs, ok?.expiresAtMs),
          (CommandType.seek, 42000, 9));
      expect(
          CommandInstruction.tryParse(
              {'commandId': 'c2', 'type': 'self-destruct', 'expiresAtMs': 1}),
          isNull);
      expect(
          CommandInstruction.tryParse({'commandId': 'c3', 'type': 'next'})
              ?.expiresAtMs,
          0);
    });
  });

  group('phase 2 models', () {
    Map<String, dynamic> songJson() => {
          'id': 's1',
          'title': 'T',
          'artist': 'A',
          'artistId': 'ar1',
          'album': 'B',
          'albumId': 'al1',
          'suffix': 'mp3',
        };

    test('CommandType maps to and from the snake_case wire names', () {
      expect(CommandType.queuePlay.wire, 'queue_play');
      expect(CommandType.queueRemove.wire, 'queue_remove');
      expect(CommandType.queueMove.wire, 'queue_move');
      expect(CommandType.queueAdd.wire, 'queue_add');
      expect(CommandType.volume.wire, 'volume');
      expect(CommandType.next.wire, 'next');
      for (final t in CommandType.values) {
        expect(CommandType.fromWire(t.wire), t);
      }
      expect(CommandType.fromWire('queuePlay'),
          isNull); // the Dart name is not the wire name
      expect(CommandType.fromWire('self-destruct'), isNull);
      expect(CommandType.fromWire(null), isNull);
    });

    test('CommandInstruction.tryParse reads volume and queue arguments', () {
      final v = CommandInstruction.tryParse({
        'commandId': 'c1',
        'type': 'volume',
        'volume': 0.25,
        'expiresAtMs': 9
      })!;
      expect((v.type, v.volume), (CommandType.volume, 0.25));

      final m = CommandInstruction.tryParse({
        'commandId': 'c2',
        'type': 'queue_move',
        'index': 3,
        'to': 1,
        'songId': 's3',
        'expiresAtMs': 9
      })!;
      expect((m.type, m.index, m.to, m.songId),
          (CommandType.queueMove, 3, 1, 's3'));

      final a = CommandInstruction.tryParse({
        'commandId': 'c3',
        'type': 'queue_add',
        'mode': 'end',
        'expiresAtMs': 9,
        'songs': [songJson(), songJson()],
      })!;
      expect((a.type, a.mode, a.songs.length),
          (CommandType.queueAdd, QueueAddMode.end, 2));
    });

    test('CommandInstruction.tryParse never throws on malformed arguments', () {
      final c = CommandInstruction.tryParse({
        'commandId': 'c1',
        'type': 'queue_add',
        'expiresAtMs': 9,
        'volume': 'loud',
        'index': 'zero',
        'to': [],
        'songId': 7,
        'mode': 'sideways',
        'songs': [
          null,
          'x',
          {'title': 'no id'},
          {'id': 'bad'},
          songJson()
        ],
      })!;
      expect((c.volume, c.index, c.to, c.songId, c.mode),
          (null, null, null, null, null));
      expect(c.songs.length, 1); // only the one that really is a song
    });

    test(
        'PublicState reads the volume (full volume from an older server) and copies it',
        () {
      Map<String, dynamic> j([Object? v = 'omit']) => {
            'activeDeviceId': 'd',
            'playing': true,
            'index': 0,
            'queueLength': 1,
            'queueVersion': 1,
            'positionMs': 0,
            'positionAtMs': 0,
            'repeat': 'off',
            'shuffle': false,
            'counted': false,
            if (v != 'omit') 'volume': v,
          };
      expect(PublicState.fromJson(j()).volume, 1.0);
      expect(PublicState.fromJson(j(0.4)).volume, 0.4);
      expect(PublicState.fromJson(j(7)).volume, 1.0);
      expect(PublicState.fromJson(j(-1)).volume, 0.0);
      expect(PublicState.fromJson(j(0.4)).copyWith(volume: 0.9).volume, 0.9);
      expect(PublicState.fromJson(j(0.4)).copyWith(playing: false).volume, 0.4);
    });

    test('CommandArgs only serialises what is set', () {
      expect(const CommandArgs().toJson(), isEmpty);
      expect(
          const CommandArgs(
                  volume: 0.5,
                  index: 1,
                  to: 2,
                  songId: 's',
                  songIds: ['a'],
                  mode: QueueAddMode.end)
              .toJson(),
          {
            'volume': 0.5,
            'index': 1,
            'to': 2,
            'songId': 's',
            'songIds': ['a'],
            'mode': 'end'
          });
    });
  });
}
