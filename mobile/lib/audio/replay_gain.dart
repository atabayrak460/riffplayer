import 'dart:math';

/// How tracks are levelled to a common loudness. Mirrors `web/src/store/playback.ts`.
enum ReplayGainMode { off, track, album }

/// Linear output volume (0.0–1.0) for a track: its ReplayGain plus [preampDb],
/// clamped to just_audio's range — so a positive gain can't boost above full
/// volume, only restore it. Album mode uses the album gain and falls back to
/// the track gain when a file has none; untagged tracks and [ReplayGainMode.off]
/// leave the volume at 1.0.
double replayGainVolume({
  required ReplayGainMode mode,
  double? trackGainDb,
  double? albumGainDb,
  double preampDb = 0,
}) {
  if (mode == ReplayGainMode.off) return 1.0;
  final gainDb =
      mode == ReplayGainMode.album ? (albumGainDb ?? trackGainDb) : trackGainDb;
  if (gainDb == null) return 1.0;
  return pow(10, (gainDb + preampDb) / 20).toDouble().clamp(0.0, 1.0);
}
