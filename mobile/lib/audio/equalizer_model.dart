import 'dart:math';

/// Centre frequencies (Hz) the presets are written for — the same ten bands as
/// the web equalizer (`web/src/store/equalizer.ts`). Android's equalizer has
/// whatever bands the phone's audio hardware offers (often five), so a preset is
/// a *curve* that is sampled at the phone's own band frequencies.
const eqReferenceHz = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const eqPresets = <String, List<double>>{
  'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  'Vocal': [-2, -2, -1, 1, 3, 3, 2, 1, 0, -1],
  'Rock': [4, 3, 1, -1, -2, 0, 2, 3, 4, 4],
  'Electronic': [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
  'Classical': [0, 0, 0, 0, 0, 0, -2, -3, -3, -4],
  'Loudness': [5, 3, 0, 0, -1, -1, 0, 1, 3, 4],
};

const customPreset = 'Custom';

/// Gains (dB) for bands centred at [centersHz], read off preset [name]'s curve
/// (linear in log-frequency between the reference bands) and clamped to
/// [minDb]..[maxDb]. Unknown names give a flat curve.
List<double> presetGainsFor(
    String name, List<double> centersHz, double minDb, double maxDb) {
  final curve = eqPresets[name] ?? eqPresets['Flat']!;
  double at(double hz) {
    if (hz <= eqReferenceHz.first) return curve.first;
    if (hz >= eqReferenceHz.last) return curve.last;
    for (var i = 0; i < eqReferenceHz.length - 1; i++) {
      final lo = eqReferenceHz[i].toDouble();
      final hi = eqReferenceHz[i + 1].toDouble();
      if (hz <= hi) {
        final t = (log(hz) - log(lo)) / (log(hi) - log(lo));
        return curve[i] + (curve[i + 1] - curve[i]) * t;
      }
    }
    return curve.last;
  }

  return [
    for (final hz in centersHz)
      ((at(hz) * 2).round() / 2).clamp(minDb, maxDb).toDouble(),
  ];
}

/// What the phone's equalizer offers.
class EqBands {
  const EqBands(this.centersHz, this.minDb, this.maxDb);
  final List<double> centersHz;
  final double minDb;
  final double maxDb;
}

/// The device equalizer behind a small interface, so the logic above it can be
/// tested without a phone.
abstract class EqualizerBackend {
  /// The band layout, or null while the player hasn't been started yet (the
  /// platform equalizer only exists once audio has been loaded).
  Future<EqBands?> bands();
  Future<void> setEnabled(bool enabled);
  Future<void> setGain(int band, double db);
}
