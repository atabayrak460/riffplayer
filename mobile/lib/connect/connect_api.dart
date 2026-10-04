// RiffPlayer Connect HTTP client (docs/CONNECT-DESIGN.md). Every call maps the HTTP outcome to a small
// enum instead of throwing, so the notifier can react to "need_queue" / "no_active_device" etc.

import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:just_audio/just_audio.dart' show LoopMode;
import '../api/types.dart';
import 'connect_models.dart';

class DeviceIdentity {
  final String deviceId;
  final String name;
  final DeviceType type;

  const DeviceIdentity(
      {required this.deviceId, required this.name, required this.type});

  String toQuery() =>
      'deviceId=${Uri.encodeQueryComponent(deviceId)}&name=${Uri.encodeQueryComponent(name)}&type=${type.name}';
}

class StateReport {
  final String deviceId;
  final List<String>? queueIds;
  final int index;
  final int positionMs;
  final bool playing;
  final LoopMode repeat;
  final bool shuffle;
  final bool counted;

  /// This device's player volume, 0.0–1.0.
  final double volume;

  const StateReport({
    required this.deviceId,
    required this.queueIds,
    required this.index,
    required this.positionMs,
    required this.playing,
    required this.repeat,
    required this.shuffle,
    required this.counted,
    this.volume = 1.0,
  });

  Map<String, Object?> toJson() => {
        'deviceId': deviceId,
        if (queueIds != null) 'queueIds': queueIds,
        'index': index,
        'positionMs': positionMs,
        'playing': playing,
        'repeat': loopModeToWire(repeat),
        'shuffle': shuffle,
        'counted': counted,
        'volume': volume,
      };
}

enum ReportResult {
  ok,
  okTakeover,
  notActive,
  needQueue,
  unknownDevice,
  rateLimited,
  unavailable,
  error
}

enum CommandResult {
  sent,
  noActiveDevice,
  self,
  targetChanged,
  unknownDevice,
  rateLimited,
  unavailable,
  error,
}

enum TransferResult {
  ok,
  pending,
  noop,
  targetOffline,
  nothingPlaying,
  unknownDevice,
  rateLimited,
  unavailable,
  error,
}

class StreamOpen {
  final int status;

  /// Decoded text of the event stream; null unless [status] is 200.
  final Stream<String>? text;
  const StreamOpen(this.status, this.text);
}

class PolledEvent {
  final int seq;
  final String name;
  final Object? data;
  const PolledEvent(this.seq, this.name, this.data);
}

class PollResult {
  final int status;
  final List<PolledEvent> events;
  const PollResult(this.status, this.events);
}

abstract class ConnectApi {
  /// Throws on a network failure.
  Future<StreamOpen> openStream(DeviceIdentity identity, CancelToken cancel);
  Future<PollResult> pollOnce(
      DeviceIdentity identity, int? since, CancelToken cancel);
  Future<ReportResult> reportState(StateReport report);

  /// [targetDeviceId] is the device the sender saw playing; the server refuses the command
  /// ([CommandResult.targetChanged]) if another device has taken over since.
  Future<CommandResult> sendCommand(String deviceId, CommandType type,
      {int? positionMs, String? targetDeviceId, CommandArgs? args});
  Future<TransferResult> transfer(String deviceId, String toDeviceId,
      {bool play = true});
  Future<bool> renameDevice(String deviceId, String name);

  /// Tells the other devices where this one's sound comes out (null = its own speaker).
  Future<bool> setOutput(String deviceId, String? output);
  Future<QueueResult?> fetchQueue();
}

class HttpConnectApi implements ConnectApi {
  final Credentials credentials;
  final Dio _dio;

  HttpConnectApi(this.credentials, {Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 30),
              // Statuses are part of the protocol (409 need_queue, 404 on an older server...), not errors.
              validateStatus: (_) => true,
            ));

  String get _base =>
      '${credentials.serverUrl.replaceFirst(RegExp(r'/$'), '')}/api/v1/connect';

  Map<String, String> get _auth => {
        if (credentials.token != null)
          'Authorization': 'Bearer ${credentials.token}',
      };

  @override
  Future<StreamOpen> openStream(
      DeviceIdentity identity, CancelToken cancel) async {
    final res = await _dio.get<ResponseBody>(
      '$_base/stream?${identity.toQuery()}',
      cancelToken: cancel,
      options: Options(
        responseType: ResponseType.stream,
        headers: {..._auth, 'Accept': 'text/event-stream'},
        // The heartbeat arrives every 20 s; Dio's receive timeout is the gap *between* chunks.
        receiveTimeout: const Duration(seconds: 70),
      ),
    );
    if (res.statusCode != 200 || res.data == null) {
      return StreamOpen(res.statusCode ?? 0, null);
    }
    return StreamOpen(200, utf8.decoder.bind(res.data!.stream));
  }

  @override
  Future<PollResult> pollOnce(
      DeviceIdentity identity, int? since, CancelToken cancel) async {
    final query = identity.toQuery() + (since != null ? '&since=$since' : '');
    final res = await _dio.get<Object>(
      '$_base/poll?$query',
      cancelToken: cancel,
      options:
          Options(headers: _auth, receiveTimeout: const Duration(seconds: 40)),
    );
    final status = res.statusCode ?? 0;
    if (status != 200 || res.data is! Map) return PollResult(status, const []);
    final events = ((res.data! as Map)['events'] as List<dynamic>? ?? [])
        .map((e) => PolledEvent(
              (e['seq'] as num).toInt(),
              e['event'] as String,
              e['data'],
            ))
        .toList();
    return PollResult(status, events);
  }

  Future<Response<Object>?> _send(
      String method, String path, Object data) async {
    try {
      return await _dio.request<Object>(
        '$_base/$path',
        data: data,
        options: Options(
            method: method,
            headers: _auth,
            contentType: Headers.jsonContentType),
      );
    } on DioException {
      return null; // network failure
    }
  }

  static String? _errorCode(Response<Object> res) {
    final data = res.data;
    return data is Map ? data['error'] as String? : null;
  }

  @override
  Future<ReportResult> reportState(StateReport report) async {
    final res = await _send('POST', 'state', report.toJson());
    if (res == null) return ReportResult.error;
    switch (res.statusCode) {
      case 404:
        return ReportResult.unavailable;
      case 429:
        return ReportResult.rateLimited;
      case 409:
        return _errorCode(res) == 'need_queue'
            ? ReportResult.needQueue
            : ReportResult.unknownDevice;
    }
    if (res.statusCode == null || res.statusCode! >= 300) {
      return ReportResult.error;
    }
    final body = res.data;
    if (body is! Map || body['accepted'] != true) return ReportResult.notActive;
    return body['takeover'] == true ? ReportResult.okTakeover : ReportResult.ok;
  }

  @override
  Future<CommandResult> sendCommand(String deviceId, CommandType type,
      {int? positionMs, String? targetDeviceId, CommandArgs? args}) async {
    final res = await _send('POST', 'command', {
      'deviceId': deviceId,
      'commandId': newDeviceId(),
      'type': type.wire,
      ...?args?.toJson(),
      if (positionMs != null) 'positionMs': positionMs,
      if (targetDeviceId != null) 'targetDeviceId': targetDeviceId,
    });
    if (res == null) return CommandResult.error;
    switch (res.statusCode) {
      case 404:
        return CommandResult.unavailable;
      case 429:
        return CommandResult.rateLimited;
      case 409:
        return switch (_errorCode(res)) {
          'no_active_device' => CommandResult.noActiveDevice,
          'self' => CommandResult.self,
          'target_changed' => CommandResult.targetChanged,
          _ => CommandResult.unknownDevice,
        };
    }
    return res.statusCode != null && res.statusCode! < 300
        ? CommandResult.sent
        : CommandResult.error;
  }

  @override
  Future<TransferResult> transfer(String deviceId, String toDeviceId,
      {bool play = true}) async {
    final res = await _send('POST', 'transfer',
        {'deviceId': deviceId, 'toDeviceId': toDeviceId, 'play': play});
    if (res == null) return TransferResult.error;
    switch (res.statusCode) {
      case 429:
        return TransferResult.rateLimited;
      case 404:
        return _errorCode(res) == 'target_offline'
            ? TransferResult.targetOffline
            : TransferResult.unavailable;
      case 409:
        return _errorCode(res) == 'nothing_playing'
            ? TransferResult.nothingPlaying
            : TransferResult.unknownDevice;
    }
    if (res.statusCode == null || res.statusCode! >= 300) {
      return TransferResult.error;
    }
    final status = res.data is Map ? (res.data! as Map)['status'] : null;
    return switch (status) {
      'pending' => TransferResult.pending,
      'noop' => TransferResult.noop,
      _ => TransferResult.ok,
    };
  }

  @override
  Future<bool> renameDevice(String deviceId, String name) async {
    final res =
        await _send('PATCH', 'device', {'deviceId': deviceId, 'name': name});
    return res != null && res.statusCode != null && res.statusCode! < 300;
  }

  @override
  Future<bool> setOutput(String deviceId, String? output) async {
    final res = await _send(
        'PATCH', 'device', {'deviceId': deviceId, 'output': output});
    return res != null && res.statusCode != null && res.statusCode! < 300;
  }

  @override
  Future<QueueResult?> fetchQueue() async {
    try {
      final res = await _dio.get<Object>('$_base/queue',
          options: Options(headers: _auth));
      if (res.statusCode != 200 || res.data is! Map) return null;
      return QueueResult.fromJson(Map<String, dynamic>.from(res.data! as Map));
    } on DioException {
      return null;
    }
  }
}
