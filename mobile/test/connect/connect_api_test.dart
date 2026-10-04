import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart' show LoopMode;
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/connect/connect_api.dart';
import 'package:riffplayer_mobile/connect/connect_models.dart';

import '../helpers/fake_http.dart';

const creds = Credentials(
    serverUrl: 'http://srv:4533/', username: 'u', password: 'p', token: 'tok');
const identity = DeviceIdentity(
    deviceId: 'dev-12345678', name: 'My PC & more', type: DeviceType.android);

void main() {
  late FakeAdapter adapter;
  late HttpConnectApi api;

  setUp(() {
    adapter = FakeAdapter();
    final dio = Dio(BaseOptions(validateStatus: (_) => true))
      ..httpClientAdapter = adapter;
    api = HttpConnectApi(creds, dio: dio);
  });

  StateReport report({List<String>? queueIds}) => StateReport(
        deviceId: 'dev-12345678',
        queueIds: queueIds,
        index: 1,
        positionMs: 5000,
        playing: true,
        repeat: LoopMode.all,
        shuffle: true,
        counted: false,
      );

  group('reportState', () {
    test(
        'POSTs the report with the bearer token, leaving out the queue when it is not being sent',
        () async {
      adapter.responder = (_) => json(200, {'accepted': true});
      await api.reportState(report());

      expect(
          adapter.last.uri.toString(), 'http://srv:4533/api/v1/connect/state');
      expect(adapter.last.method, 'POST');
      expect(adapter.last.headers['Authorization'], 'Bearer tok');
      expect(adapter.last.data, {
        'deviceId': 'dev-12345678',
        'index': 1,
        'positionMs': 5000,
        'playing': true,
        'repeat': 'all',
        'shuffle': true,
        'counted': false,
        'volume': 1.0,
      });
    });

    test('includes the queue ids when given', () async {
      await api.reportState(report(queueIds: ['a', 'b']));
      expect((adapter.last.data as Map)['queueIds'], ['a', 'b']);
    });

    final cases = <(int, Object, ReportResult)>[
      (200, {'accepted': true, 'takeover': true}, ReportResult.okTakeover),
      (200, {'accepted': true}, ReportResult.ok),
      (
        200,
        {'accepted': false, 'reason': 'not_active'},
        ReportResult.notActive
      ),
      (409, {'error': 'need_queue'}, ReportResult.needQueue),
      (409, {'error': 'unknown_device'}, ReportResult.unknownDevice),
      (429, {'error': 'rate_limited'}, ReportResult.rateLimited),
      (404, {'error': 'Not found'}, ReportResult.unavailable),
      (500, {'error': 'boom'}, ReportResult.error),
    ];
    for (final (status, body, expected) in cases) {
      test('maps HTTP $status $body to $expected', () async {
        adapter.responder = (_) => json(status, body);
        expect(await api.reportState(report()), expected);
      });
    }

    test('reports a network failure as an error instead of throwing', () async {
      adapter.responder = (o) => throw DioException(
          requestOptions: o, type: DioExceptionType.connectionError);
      expect(await api.reportState(report()), ReportResult.error);
    });
  });

  group('sendCommand', () {
    test(
        'sends a fresh command id each time and only includes a position when given',
        () async {
      adapter.responder = (_) => json(202, {'delivered': true});

      expect(await api.sendCommand('dev-12345678', CommandType.next),
          CommandResult.sent);
      final first = Map<String, dynamic>.from(adapter.last.data as Map);
      await api.sendCommand('dev-12345678', CommandType.seek,
          positionMs: 12346);
      final second = Map<String, dynamic>.from(adapter.last.data as Map);

      expect(first['type'], 'next');
      expect(first.containsKey('positionMs'), isFalse);
      expect((second['type'], second['positionMs']), ('seek', 12346));
      expect(first['commandId'], isNot(second['commandId']));
    });

    test(
        'names the device it saw playing, so the server can refuse the command if another one took over',
        () async {
      adapter.responder = (_) => json(202, {'delivered': true});

      await api.sendCommand('dev-12345678', CommandType.next,
          targetDeviceId: 'playing-dev-01');
      expect((adapter.last.data as Map)['targetDeviceId'], 'playing-dev-01');

      await api.sendCommand('dev-12345678', CommandType.seek,
          positionMs: 5000, targetDeviceId: 'playing-dev-01');
      expect((adapter.last.data as Map)['positionMs'], 5000);
      expect((adapter.last.data as Map)['targetDeviceId'], 'playing-dev-01');

      await api.sendCommand('dev-12345678', CommandType.next);
      expect((adapter.last.data as Map).containsKey('targetDeviceId'), isFalse);
    });

    final cases = <(int, Object, CommandResult)>[
      (409, {'error': 'target_changed'}, CommandResult.targetChanged),
      (409, {'error': 'no_active_device'}, CommandResult.noActiveDevice),
      (409, {'error': 'self'}, CommandResult.self),
      (409, {'error': 'unknown_device'}, CommandResult.unknownDevice),
      (429, {}, CommandResult.rateLimited),
      (404, {}, CommandResult.unavailable),
      (500, {}, CommandResult.error),
    ];
    for (final (status, body, expected) in cases) {
      test('maps HTTP $status $body to $expected', () async {
        adapter.responder = (_) => json(status, body);
        expect(
            await api.sendCommand('dev-12345678', CommandType.pause), expected);
      });
    }

    test('survives a network failure', () async {
      adapter.responder = (o) => throw DioException(
          requestOptions: o, type: DioExceptionType.connectionTimeout);
      expect(await api.sendCommand('dev-12345678', CommandType.pause),
          CommandResult.error);
    });
  });

  group('transfer', () {
    test('POSTs from, to and play', () async {
      adapter.responder = (_) => json(202, {'status': 'pending'});
      await api.transfer('dev-aaaaaaaa', 'dev-bbbbbbbb', play: false);

      expect(adapter.last.uri.path, '/api/v1/connect/transfer');
      expect(adapter.last.data, {
        'deviceId': 'dev-aaaaaaaa',
        'toDeviceId': 'dev-bbbbbbbb',
        'play': false
      });
    });

    final cases = <(int, Object, TransferResult)>[
      (200, {'status': 'done'}, TransferResult.ok),
      (202, {'status': 'pending'}, TransferResult.pending),
      (200, {'status': 'noop'}, TransferResult.noop),
      (404, {'error': 'target_offline'}, TransferResult.targetOffline),
      (404, {'error': 'Not found'}, TransferResult.unavailable),
      (409, {'error': 'nothing_playing'}, TransferResult.nothingPlaying),
      (409, {'error': 'unknown_device'}, TransferResult.unknownDevice),
      (429, {}, TransferResult.rateLimited),
      (500, {}, TransferResult.error),
    ];
    for (final (status, body, expected) in cases) {
      test('maps HTTP $status $body to $expected', () async {
        adapter.responder = (_) => json(status, body);
        expect(await api.transfer('dev-aaaaaaaa', 'dev-bbbbbbbb'), expected);
      });
    }
  });

  group('phase 2 commands', () {
    test('send the snake_case wire name and only the arguments they carry',
        () async {
      adapter.responder = (_) => json(202, {'delivered': true});

      await api.sendCommand('dev-12345678', CommandType.volume,
          args: const CommandArgs(volume: 0.4));
      var body = Map<String, dynamic>.from(adapter.last.data as Map);
      expect((body['type'], body['volume']), ('volume', 0.4));
      expect(body.containsKey('index'), isFalse);

      await api.sendCommand('dev-12345678', CommandType.queueMove,
          args: const CommandArgs(index: 4, to: 1, songId: 's4'));
      body = Map<String, dynamic>.from(adapter.last.data as Map);
      expect((body['type'], body['index'], body['to'], body['songId']),
          ('queue_move', 4, 1, 's4'));

      await api.sendCommand('dev-12345678', CommandType.queueAdd,
          args:
              const CommandArgs(mode: QueueAddMode.next, songIds: ['a', 'b']));
      body = Map<String, dynamic>.from(adapter.last.data as Map);
      expect((body['type'], body['mode']), ('queue_add', 'next'));
      expect(body['songIds'], ['a', 'b']);

      await api.sendCommand('dev-12345678', CommandType.queueRemove,
          args: const CommandArgs(index: 0, songId: 'x'));
      expect((adapter.last.data as Map)['type'], 'queue_remove');
      await api.sendCommand('dev-12345678', CommandType.queuePlay,
          args: const CommandArgs(index: 0, songId: 'x'));
      expect((adapter.last.data as Map)['type'], 'queue_play');
    });

    test('keep targeting the device the sender saw', () async {
      adapter.responder = (_) => json(202, {'delivered': true});
      await api.sendCommand('dev-12345678', CommandType.volume,
          targetDeviceId: 'playing-dev-01', args: const CommandArgs(volume: 1));
      expect((adapter.last.data as Map)['targetDeviceId'], 'playing-dev-01');
    });

    test('the reported volume goes out with the state', () async {
      adapter.responder = (_) => json(200, {'accepted': true});
      await api.reportState(const StateReport(
        deviceId: 'dev-12345678',
        queueIds: null,
        index: 0,
        positionMs: 0,
        playing: true,
        repeat: LoopMode.off,
        shuffle: false,
        counted: false,
        volume: 0.35,
      ));
      expect((adapter.last.data as Map)['volume'], 0.35);
    });

    test('fetchQueue carries the real positions of the songs', () async {
      Map<String, dynamic> s(String id) => {
            'id': id,
            'title': id,
            'artist': 'X',
            'artistId': 'x',
            'album': 'Y',
            'albumId': 'y',
            'suffix': 'mp3'
          };
      adapter.responder = (_) => json(200, {
            'queueVersion': 3,
            'index': 1,
            'songs': [s('a'), s('c')],
            'positions': [0, 2],
          });
      expect((await api.fetchQueue())?.positions, [0, 2]);

      // A server that doesn't send them (or sends nonsense) means "as listed".
      adapter.responder = (_) => json(200, {
            'queueVersion': 3,
            'index': 0,
            'songs': [s('a'), s('c')],
            'positions': [0],
          });
      expect((await api.fetchQueue())?.positions, [0, 1]);
    });
  });

  group('renameDevice and fetchQueue', () {
    test('renameDevice PATCHes the name and reports success', () async {
      adapter.responder = (_) => json(200, {'ok': true});
      expect(await api.renameDevice('dev-12345678', 'Living room'), isTrue);
      expect(adapter.last.method, 'PATCH');
      expect(adapter.last.data,
          {'deviceId': 'dev-12345678', 'name': 'Living room'});

      adapter.responder = (_) => json(404, {});
      expect(await api.renameDevice('dev-12345678', 'x'), isFalse);
    });

    test(
        'fetchQueue returns the queue, or null when there is none or the request fails',
        () async {
      adapter.responder = (_) => json(200, {
            'queueVersion': 3,
            'index': 1,
            'songs': [
              {
                'id': 'a',
                'title': 'A',
                'artist': 'X',
                'artistId': 'x',
                'album': 'Y',
                'albumId': 'y',
                'suffix': 'mp3'
              },
            ],
          });
      final q = await api.fetchQueue();
      expect((q?.queueVersion, q?.index, q?.songs.single.id), (3, 1, 'a'));

      adapter.responder = (_) => json(404, {'error': 'nothing_playing'});
      expect(await api.fetchQueue(), isNull);

      adapter.responder = (o) => throw DioException(
          requestOptions: o, type: DioExceptionType.connectionError);
      expect(await api.fetchQueue(), isNull);
    });
  });

  group('streams', () {
    test(
        'openStream sends the identity in the query (URL-encoded), asks for an event stream, and decodes the text',
        () async {
      // a multi-byte character split across two network chunks must still decode correctly
      final bytes = utf8.encode('event: devices\ndata: "héllo"\n\n');
      final split = bytes.indexOf(0xC3) + 1;
      adapter.responder = (_) => ResponseBody(
            Stream.fromIterable([
              Uint8List.fromList(bytes.sublist(0, split)),
              Uint8List.fromList(bytes.sublist(split))
            ]),
            200,
            headers: {
              Headers.contentTypeHeader: ['text/event-stream']
            },
          );

      final open = await api.openStream(identity, CancelToken());

      expect(adapter.last.uri.toString(),
          'http://srv:4533/api/v1/connect/stream?deviceId=dev-12345678&name=My+PC+%26+more&type=android');
      expect(adapter.last.headers['Accept'], 'text/event-stream');
      expect(adapter.last.headers['Authorization'], 'Bearer tok');
      expect(open.status, 200);
      expect(await open.text!.join(), 'event: devices\ndata: "héllo"\n\n');
    });

    test(
        'openStream hands back the status with no body when the server refuses',
        () async {
      adapter.responder = (_) => json(404, {'error': 'Not found'});
      final open = await api.openStream(identity, CancelToken());
      expect((open.status, open.text), (404, null));
    });

    test('pollOnce omits `since` on the first call and sends it afterwards',
        () async {
      adapter.responder = (_) => json(200, {
            'events': [
              {
                'seq': 1,
                'event': 'hello',
                'data': {'you': 'x'}
              },
            ],
          });

      final first = await api.pollOnce(identity, null, CancelToken());
      expect(adapter.last.uri.query.contains('since'), isFalse);
      expect(first.status, 200);
      expect((first.events.single.seq, first.events.single.name), (1, 'hello'));

      await api.pollOnce(identity, 5, CancelToken());
      expect(adapter.last.uri.query, contains('&since=5'));
    });

    test(
        'pollOnce hands back the status with no events when the server refuses',
        () async {
      adapter.responder = (_) => json(404, {});
      final r = await api.pollOnce(identity, 3, CancelToken());
      expect(r.status, 404);
      expect(r.events, isEmpty);
    });
  });
}
