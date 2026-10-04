import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/audio/equalizer_model.dart';

void main() {
  test('every preset has one gain per reference band', () {
    for (final e in eqPresets.entries) {
      expect(e.value.length, eqReferenceHz.length, reason: e.key);
    }
  });

  group('presetGainsFor', () {
    test('at the reference frequencies it returns the preset itself', () {
      final g = presetGainsFor(
          'Rock', [for (final hz in eqReferenceHz) hz.toDouble()], -15, 15);
      expect(g, eqPresets['Rock']);
    });

    test('a typical 5-band phone gets the curve sampled at its own bands', () {
      // Android's usual layout.
      final g =
          presetGainsFor('Bass boost', [60, 230, 910, 3600, 14000], -15, 15);
      expect(g.length, 5);
      expect(g.first, greaterThan(g[2])); // bass up
      expect(g.last, 0); // treble untouched
      expect(g.every((x) => x >= 0), isTrue);
    });

    test('frequencies outside the reference range use the end values', () {
      final g = presetGainsFor('Bass boost', [20, 20000], -15, 15);
      expect(g, [6, 0]);
    });

    test('clamps to what the phone supports, in half-dB steps', () {
      final g = presetGainsFor('Bass boost', [31, 62], -3, 3);
      expect(g, [3, 3]);
      final h = presetGainsFor('Vocal', [750], -15, 15);
      expect((h.first * 2) % 1, 0);
    });

    test('an unknown preset is flat', () {
      expect(presetGainsFor('Nope', [100, 1000], -15, 15), [0, 0]);
    });
  });
}
