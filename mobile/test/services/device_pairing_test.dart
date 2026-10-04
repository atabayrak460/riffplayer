import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/api/subsonic.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/services/auth_service.dart';
import 'package:riffplayer_mobile/services/device_pairing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/fake_http.dart';

DevicePairingService _service(FakeAdapter adapter) {
  final dio = Dio(BaseOptions(validateStatus: (s) => s != null && s < 500))
    ..httpClientAdapter = adapter;
  return DevicePairingService(dio: dio);
}

void main() {
  group('normaliseServerUrl', () {
    test(
        'adds http:// when no scheme was typed, trims and drops trailing slashes',
        () {
      expect(DevicePairingService.normaliseServerUrl(' 192.168.1.20:4533/ '),
          'http://192.168.1.20:4533');
      expect(
          DevicePairingService.normaliseServerUrl('https://music.example.com//'),
          'https://music.example.com');
      expect(
          DevicePairingService.normaliseServerUrl('HTTP://Host'), 'HTTP://Host');
      expect(DevicePairingService.normaliseServerUrl('   '), '');
    });
  });

  group('start', () {
    test('asks the server for a code, naming the TV, and returns what to show',
        () async {
      final adapter = FakeAdapter()
        ..responder = (_) => json(200, {
              'deviceCode': 'd' * 48,
              'userCode': 'ABCD-EFGH',
              'expiresIn': 600,
              'interval': 3,
            });
      final p = await _service(adapter)
          .start('192.168.1.20:4533', deviceName: 'Android TV');

      expect(p.userCode, 'ABCD-EFGH');
      expect(p.interval, 3);
      expect(adapter.last.uri.toString(),
          'http://192.168.1.20:4533/api/v1/auth/device-code');
      expect(adapter.last.data, {'deviceName': 'Android TV'});
    });

    test('explains an older server that has no linking', () async {
      final adapter = FakeAdapter()
        ..responder = (_) => json(404, {'error': 'nope'});
      expect(_service(adapter).start('http://old'), throwsA(isA<Exception>()));
    });
  });

  group('poll', () {
    test('202 means keep waiting', () async {
      final adapter = FakeAdapter()
        ..responder = (_) => json(202, {'status': 'pending'});
      expect(
          await _service(adapter).poll('http://s', 'x'), isA<PairingPending>());
    });

    test('410 means the code is gone', () async {
      final adapter = FakeAdapter()
        ..responder = (_) => json(410, {'error': 'expired'});
      expect(
          await _service(adapter).poll('http://s', 'x'), isA<PairingExpired>());
    });

    test(
        'an approval yields credentials with a token and an API key, never a password',
        () async {
      final adapter = FakeAdapter()
        ..responder = (_) => json(200, {
              'status': 'approved',
              'token': 'jwt-1',
              'apiKey': 'key-1',
              'user': {'id': 1, 'username': 'atabay', 'role': 'user'},
            });
      final r = await _service(adapter).poll('s.example:4533/', 'x');

      expect(r, isA<PairingApproved>());
      final c = (r as PairingApproved).credentials;
      expect(c.serverUrl, 'http://s.example:4533');
      expect(c.username, 'atabay');
      expect(c.token, 'jwt-1');
      expect(c.apiKey, 'key-1');
      expect(c.password, isEmpty);
    });
  });

  group('a linked device signs in with its API key', () {
    const linked = Credentials(
      serverUrl: 'http://s',
      username: 'atabay',
      password: '',
      token: 'jwt',
      apiKey: 'key-1',
    );

    test('Subsonic URLs carry apiKey instead of a token and salt', () {
      final params =
          Uri.parse(SubsonicClient(linked).streamUrl('t1')).queryParameters;
      expect(params['apiKey'], 'key-1');
      expect(params['u'], 'atabay');
      expect(params.containsKey('t'), isFalse);
      expect(params.containsKey('s'), isFalse);
    });

    test('a normal login still uses token + salt', () {
      const normal =
          Credentials(serverUrl: 'http://s', username: 'a', password: 'pw');
      final params =
          Uri.parse(SubsonicClient(normal).streamUrl('t1')).queryParameters;
      expect(params.containsKey('apiKey'), isFalse);
      expect(params['t'], isNotEmpty);
    });

    test('copyWith keeps the API key', () {
      expect(linked.copyWith(token: 'new').apiKey, 'key-1');
    });

    test('it is stored and loaded, and removed on sign-out', () async {
      SharedPreferences.setMockInitialValues({});
      final svc = AuthService();
      await svc.save(linked);
      final loaded = await svc.load();
      expect(loaded?.apiKey, 'key-1');
      expect(loaded?.token, 'jwt');

      await svc.clear();
      expect(await svc.load(), isNull);
    });

    test("approving a code from the phone posts it with the user's own login",
        () async {
      final adapter = FakeAdapter()
        ..responder =
            (_) => json(200, {'ok': true, 'deviceName': 'Living room TV'});
      final dio = Dio()..httpClientAdapter = adapter;
      final client = SubsonicClient(
          const Credentials(
              serverUrl: 'http://s',
              username: 'a',
              password: 'pw',
              token: 'jwt-9'),
          dio: dio);
      expect(await client.approveDeviceCode('ABCD-EFGH'), 'Living room TV');
      expect(adapter.last.uri.path, '/api/v1/auth/device-approve');
      expect(adapter.last.headers['Authorization'], 'Bearer jwt-9');
      expect(adapter.last.data, {'userCode': 'ABCD-EFGH'});
    });
  });
}
