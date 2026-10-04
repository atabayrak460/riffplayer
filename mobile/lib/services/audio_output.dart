import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Where the phone's sound comes out right now.
class AudioOutput {
  const AudioOutput({this.label, this.needsPermission = false});

  /// "Bluetooth: JBL Flip 6", "Headphones", … — null when it is the phone's own speaker.
  final String? label;

  /// A Bluetooth device is connected but its name can't be read until the user allows it.
  final bool needsPermission;

  @override
  bool operator ==(Object other) =>
      other is AudioOutput &&
      other.label == label &&
      other.needsPermission == needsPermission;

  @override
  int get hashCode => Object.hash(label, needsPermission);
}

/// Reads the current audio output and opens the system's output switcher. Android lets only the
/// system connect or switch Bluetooth outputs, so the app shows where the sound goes and hands over.
abstract class AudioOutputService {
  Future<AudioOutput> current();
  Future<bool> openSwitcher();
  Future<void> requestBluetoothPermission();

  /// Fires when a device appears or goes away.
  Stream<AudioOutput> get changes;
}

class PlatformAudioOutputService implements AudioOutputService {
  PlatformAudioOutputService() {
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'outputChanged') _changes.add(_parse(call.arguments));
    });
  }

  static const _channel = MethodChannel('com.riffplayer.app/audio_output');
  final _changes = StreamController<AudioOutput>.broadcast();

  static AudioOutput _parse(Object? raw) {
    if (raw is! Map) return const AudioOutput();
    return AudioOutput(
      label: raw['label'] as String?,
      needsPermission: raw['needsPermission'] as bool? ?? false,
    );
  }

  @override
  Stream<AudioOutput> get changes => _changes.stream;

  @override
  Future<AudioOutput> current() async {
    if (defaultTargetPlatform != TargetPlatform.android) {
      return const AudioOutput();
    }
    try {
      return _parse(await _channel.invokeMethod<Object>('currentOutput'));
    } on PlatformException {
      return const AudioOutput();
    } on MissingPluginException {
      return const AudioOutput();
    }
  }

  @override
  Future<bool> openSwitcher() async {
    if (defaultTargetPlatform != TargetPlatform.android) return false;
    try {
      return await _channel.invokeMethod<bool>('openSwitcher') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<void> requestBluetoothPermission() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await _channel.invokeMethod<void>('requestBluetoothPermission');
    } on PlatformException {
      // the user can still use the system switcher
    } on MissingPluginException {
      // not on a phone (tests, desktop)
    }
  }
}

final audioOutputServiceProvider =
    Provider<AudioOutputService>((ref) => PlatformAudioOutputService());

/// The current output, kept up to date as devices come and go.
class AudioOutputNotifier extends StateNotifier<AudioOutput> {
  AudioOutputNotifier(this._service) : super(const AudioOutput()) {
    _sub = _service.changes.listen((o) => state = o);
    refresh();
  }

  final AudioOutputService _service;
  StreamSubscription<AudioOutput>? _sub;

  Future<void> refresh() async {
    final o = await _service.current();
    if (mounted) state = o;
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

final audioOutputProvider =
    StateNotifierProvider<AudioOutputNotifier, AudioOutput>(
        (ref) => AudioOutputNotifier(ref.read(audioOutputServiceProvider)));
