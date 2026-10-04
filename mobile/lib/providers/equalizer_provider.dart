import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../audio/equalizer_model.dart';
import 'providers.dart';

const _enabledKey = 'eq_enabled';
const _presetKey = 'eq_preset';
const _gainsKey = 'eq_gains';

class EqualizerState {
  const EqualizerState({
    this.enabled = false,
    this.preset = 'Flat',
    this.gains = const [],
    this.bands,
  });

  final bool enabled;
  final String preset;

  /// Gain in dB for each of the phone's bands (empty until [bands] is known).
  final List<double> gains;

  /// The phone's band layout; null until audio has been played once.
  final EqBands? bands;

  EqualizerState copyWith({
    bool? enabled,
    String? preset,
    List<double>? gains,
    EqBands? bands,
  }) =>
      EqualizerState(
        enabled: enabled ?? this.enabled,
        preset: preset ?? this.preset,
        gains: gains ?? this.gains,
        bands: bands ?? this.bands,
      );
}

/// The device equalizer's settings, persisted and pushed to the phone. The band
/// layout belongs to the hardware, so the saved gains are matched to it by
/// count: if the layout ever differs, the saved curve is dropped (flat).
class EqualizerNotifier extends StateNotifier<EqualizerState> {
  EqualizerNotifier(this._backend, [super.initial = const EqualizerState()]);

  final EqualizerBackend _backend;

  /// Asks the phone for its bands (null = not ready) and applies the saved settings to them.
  Future<void> refresh() async {
    final bands = await _backend.bands();
    if (bands == null) return;
    final saved = state.gains;
    final gains = saved.length == bands.centersHz.length
        ? saved
        : presetGainsFor(state.preset == customPreset ? 'Flat' : state.preset,
            bands.centersHz, bands.minDb, bands.maxDb);
    state = state.copyWith(bands: bands, gains: gains);
    await _backend.setEnabled(state.enabled);
    for (var i = 0; i < gains.length; i++) {
      await _backend.setGain(i, gains[i]);
    }
  }

  Future<void> setEnabled(bool enabled) async {
    state = state.copyWith(enabled: enabled);
    await _backend.setEnabled(enabled);
    await _save();
  }

  Future<void> setGain(int band, double db) async {
    final bands = state.bands;
    if (bands == null || band < 0 || band >= state.gains.length) return;
    final gain =
        ((db * 2).round() / 2).clamp(bands.minDb, bands.maxDb).toDouble();
    final gains = [...state.gains]..[band] = gain;
    final match = eqPresets.keys.firstWhere(
      (name) => _sameGains(
          presetGainsFor(name, bands.centersHz, bands.minDb, bands.maxDb),
          gains),
      orElse: () => customPreset,
    );
    state = state.copyWith(gains: gains, preset: match);
    await _backend.setGain(band, gain);
    await _save();
  }

  Future<void> applyPreset(String name) async {
    final bands = state.bands;
    if (bands == null || !eqPresets.containsKey(name)) return;
    final gains =
        presetGainsFor(name, bands.centersHz, bands.minDb, bands.maxDb);
    state = state.copyWith(preset: name, gains: gains);
    for (var i = 0; i < gains.length; i++) {
      await _backend.setGain(i, gains[i]);
    }
    await _save();
  }

  Future<void> reset() => applyPreset('Flat');

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, state.enabled);
    await prefs.setString(_presetKey, state.preset);
    await prefs.setString(_gainsKey, jsonEncode(state.gains));
  }

  static bool _sameGains(List<double> a, List<double> b) =>
      a.length == b.length &&
      [for (var i = 0; i < a.length; i++) a[i] == b[i]].every((x) => x);
}

final equalizerProvider =
    StateNotifierProvider<EqualizerNotifier, EqualizerState>((ref) =>
        EqualizerNotifier(ref.read(audioHandlerProvider).equalizerBackend));

Future<EqualizerState> loadEqualizerState() async {
  final prefs = await SharedPreferences.getInstance();
  List<double> gains = const [];
  try {
    final raw = prefs.getString(_gainsKey);
    if (raw != null) {
      gains = [for (final g in jsonDecode(raw) as List) (g as num).toDouble()];
    }
  } catch (_) {
    gains = const []; // corrupted — start flat
  }
  return EqualizerState(
    enabled: prefs.getBool(_enabledKey) ?? false,
    preset: prefs.getString(_presetKey) ?? 'Flat',
    gains: gains,
  );
}
