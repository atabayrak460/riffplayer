import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../audio/audio_handler.dart';
import '../audio/replay_gain.dart';
import 'providers.dart';

const _modeKey = 'replay_gain_mode';
const _preampKey = 'replay_gain_preamp_db';
const maxPreampDb = 12.0;

class PlaybackSettings {
  const PlaybackSettings({
    this.replayGain = ReplayGainMode.track,
    this.preampDb = 0,
  });

  final ReplayGainMode replayGain;
  final double preampDb;

  PlaybackSettings copyWith({ReplayGainMode? replayGain, double? preampDb}) =>
      PlaybackSettings(
        replayGain: replayGain ?? this.replayGain,
        preampDb: preampDb ?? this.preampDb,
      );
}

/// ReplayGain mode and pre-amp, persisted and pushed to the audio handler so a
/// change applies to the song that is playing right now.
class PlaybackSettingsNotifier extends StateNotifier<PlaybackSettings> {
  PlaybackSettingsNotifier(this._handler,
      [super.initial = const PlaybackSettings()]);

  final RiffPlayerAudioHandler _handler;

  void _apply() => _handler.setReplayGain(state.replayGain, state.preampDb);

  Future<void> setReplayGain(ReplayGainMode mode) async {
    state = state.copyWith(replayGain: mode);
    _apply();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_modeKey, mode.name);
  }

  /// Rounded to half-dB steps and kept within ±[maxPreampDb].
  Future<void> setPreampDb(double db) async {
    final clamped = ((db * 2).round() / 2).clamp(-maxPreampDb, maxPreampDb);
    state = state.copyWith(preampDb: clamped.toDouble());
    _apply();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_preampKey, state.preampDb);
  }
}

final playbackSettingsProvider =
    StateNotifierProvider<PlaybackSettingsNotifier, PlaybackSettings>(
        (ref) => PlaybackSettingsNotifier(ref.read(audioHandlerProvider)));

Future<PlaybackSettings> loadPlaybackSettings() async {
  final prefs = await SharedPreferences.getInstance();
  final saved = prefs.getString(_modeKey);
  return PlaybackSettings(
    replayGain: ReplayGainMode.values
        .firstWhere((m) => m.name == saved, orElse: () => ReplayGainMode.track),
    preampDb: (prefs.getDouble(_preampKey) ?? 0)
        .clamp(-maxPreampDb, maxPreampDb)
        .toDouble(),
  );
}
