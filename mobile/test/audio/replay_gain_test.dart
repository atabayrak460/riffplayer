import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/audio/replay_gain.dart';

void main() {
  double db(double d) => pow(10, d / 20).toDouble();

  group('replayGainVolume', () {
    test('off and untagged tracks leave the volume alone', () {
      expect(
          replayGainVolume(
              mode: ReplayGainMode.off, trackGainDb: -6, albumGainDb: -3),
          1.0);
      expect(replayGainVolume(mode: ReplayGainMode.track), 1.0);
      expect(replayGainVolume(mode: ReplayGainMode.album, preampDb: 6), 1.0);
    });

    test('track mode uses the track gain, album mode the album gain', () {
      expect(
          replayGainVolume(
              mode: ReplayGainMode.track, trackGainDb: -6, albumGainDb: -3),
          closeTo(db(-6), 1e-9));
      expect(
          replayGainVolume(
              mode: ReplayGainMode.album, trackGainDb: -6, albumGainDb: -3),
          closeTo(db(-3), 1e-9));
    });

    test('album mode falls back to the track gain without an album gain', () {
      expect(replayGainVolume(mode: ReplayGainMode.album, trackGainDb: -8),
          closeTo(db(-8), 1e-9));
    });

    test('the pre-amp is added to the gain', () {
      expect(
          replayGainVolume(
              mode: ReplayGainMode.track, trackGainDb: -6, preampDb: 4),
          closeTo(db(-2), 1e-9));
    });

    test('a boost is capped at full volume, never above', () {
      expect(
          replayGainVolume(mode: ReplayGainMode.track, trackGainDb: 12), 1.0);
      expect(
          replayGainVolume(
              mode: ReplayGainMode.track, trackGainDb: -2, preampDb: 12),
          1.0);
    });
  });
}
