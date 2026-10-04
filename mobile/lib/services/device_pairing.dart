import 'package:dio/dio.dart';

import '../api/types.dart';

/// What the TV shows while it waits to be approved.
class PairingStart {
  const PairingStart({
    required this.deviceCode,
    required this.userCode,
    required this.expiresIn,
    required this.interval,
  });

  /// Secret — only the TV knows it; used to poll.
  final String deviceCode;

  /// Short code the user types on their phone / the web app.
  final String userCode;
  final int expiresIn;
  final int interval;
}

sealed class PairingPoll {
  const PairingPoll();
}

class PairingPending extends PairingPoll {
  const PairingPending();
}

class PairingExpired extends PairingPoll {
  const PairingExpired();
}

class PairingApproved extends PairingPoll {
  const PairingApproved(this.credentials);
  final Credentials credentials;
}

/// Signs a keyboard-less device in with a code approved elsewhere (see server/src/auth/devicePairing.ts).
/// The password is never typed on the TV and never sent to it: it gets a session token and an API key.
class DevicePairingService {
  DevicePairingService({Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 15),
              // 202 (still waiting) and 410 (expired) are answers, not failures.
              validateStatus: (s) => s != null && s < 500,
            ));

  final Dio _dio;

  /// Tidies what was typed on a TV remote: trims, adds http:// if no scheme was given, drops a trailing slash.
  static String normaliseServerUrl(String raw) {
    var url = raw.trim();
    if (url.isEmpty) return url;
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(url)) {
      url = 'http://$url';
    }
    return url.replaceAll(RegExp(r'/+$'), '');
  }

  Future<PairingStart> start(String serverUrl,
      {String deviceName = 'TV'}) async {
    final r = await _dio.post<Map<String, dynamic>>(
      '${normaliseServerUrl(serverUrl)}/api/v1/auth/device-code',
      data: {'deviceName': deviceName},
    );
    final j = r.data;
    if (r.statusCode != 200 || j == null) {
      throw Exception(
          'This server doesn\'t support linking a TV (update the server).');
    }
    return PairingStart(
      deviceCode: j['deviceCode'] as String,
      userCode: j['userCode'] as String,
      expiresIn: (j['expiresIn'] as num).toInt(),
      interval: (j['interval'] as num?)?.toInt() ?? 3,
    );
  }

  Future<PairingPoll> poll(String serverUrl, String deviceCode) async {
    final url = normaliseServerUrl(serverUrl);
    final r = await _dio.post<Map<String, dynamic>>(
      '$url/api/v1/auth/device-token',
      data: {'deviceCode': deviceCode},
    );
    switch (r.statusCode) {
      case 202:
        return const PairingPending();
      case 200:
        final j = r.data!;
        final user = j['user'] as Map<String, dynamic>;
        return PairingApproved(Credentials(
          serverUrl: url,
          username: user['username'] as String,
          password: '',
          token: j['token'] as String?,
          apiKey: j['apiKey'] as String?,
        ));
      default:
        return const PairingExpired();
    }
  }
}
