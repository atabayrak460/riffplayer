import '../api/types.dart';

enum QualityTier { hires, lossless, lossy, unknown }

class AudioQuality {
  const AudioQuality(this.tier, this.label, this.summary);

  final QualityTier tier;

  /// Short chip text ("Hi-Res", "Lossless", "MP3"), or null when nothing is known.
  final String? label;

  /// One line: "FLAC · 24-bit / 96 kHz · Stereo · 2304 kbps".
  final String summary;
}

const _losslessSuffixes = {
  'flac',
  'alac',
  'wav',
  'aiff',
  'aif',
  'ape',
  'wv',
  'tta',
  'dsf',
  'dff',
};

// Always lossy. m4a/mp4 can be AAC *or* ALAC, so they stay "unknown" until the
// server has read the real codec from the file.
const _lossySuffixes = {'mp3', 'ogg', 'oga', 'opus', 'aac', 'wma', 'mp2'};

String _kHz(int hz) {
  final v = (hz / 1000).toStringAsFixed(1);
  return '${v.endsWith('.0') ? v.substring(0, v.length - 2) : v} kHz';
}

/// Classifies a track the way streaming services label quality: Hi-Res =
/// lossless above CD quality (more than 16 bits or above 48 kHz), Lossless =
/// any other lossless file, otherwise lossy. Twin of `web/src/lib/quality.ts`.
AudioQuality audioQuality(Song song) {
  final suffix = song.suffix.toLowerCase();
  final lossless = song.lossless ??
      (_losslessSuffixes.contains(suffix)
          ? true
          : _lossySuffixes.contains(suffix)
              ? false
              : null);

  final codec = song.codec;
  final name =
      (codec != null && codec.length <= 12 ? codec : suffix).toUpperCase();
  final parts = <String>[
    if (name.isNotEmpty) name,
    if (song.bitDepth != null && song.samplingRate != null)
      '${song.bitDepth}-bit / ${_kHz(song.samplingRate!)}'
    else if (song.samplingRate != null)
      _kHz(song.samplingRate!)
    else if (song.bitDepth != null)
      '${song.bitDepth}-bit',
    if (song.channelCount == 1)
      'Mono'
    else if (song.channelCount == 2)
      'Stereo'
    else if (song.channelCount != null && song.channelCount! > 2)
      '${song.channelCount} channels',
    if (song.bitRate != null) '${song.bitRate} kbps',
  ];
  final summary = parts.join(' · ');
  final suffixLabel = suffix.isEmpty ? null : suffix.toUpperCase();

  if (lossless == null) {
    return AudioQuality(QualityTier.unknown, suffixLabel, summary);
  }
  if (!lossless) {
    return AudioQuality(QualityTier.lossy, suffixLabel ?? 'Lossy', summary);
  }
  final hiRes =
      (song.bitDepth ?? 16) > 16 || (song.samplingRate ?? 44100) > 48000;
  return AudioQuality(
    hiRes ? QualityTier.hires : QualityTier.lossless,
    hiRes ? 'Hi-Res' : 'Lossless',
    summary,
  );
}

/// The server's conversion decision for this user (mirrors stream.ts): it
/// converts when the preferred format differs from the file's, or the file's
/// bitrate is above the user's cap. Null = the original file is sent.
({String format, int? bitrate})? willTranscode(
    Song song, UserPreferences? prefs) {
  if (prefs == null) return null;
  final fmt = prefs.transcodeFormat?.toLowerCase();
  final cap = (prefs.transcodeBitrate ?? 0) > 0 ? prefs.transcodeBitrate : null;
  final formatChange =
      fmt != null && fmt != 'raw' && fmt != song.suffix.toLowerCase();
  final overCap = cap != null && song.bitRate != null && song.bitRate! > cap;
  if (!formatChange && !overCap) return null;
  return (format: fmt != null && fmt != 'raw' ? fmt : 'mp3', bitrate: cap);
}

class SignalStep {
  const SignalStep(this.stage, this.text, {this.degraded = false});
  final String stage; // Source / Delivery / Playback
  final String text;
  final bool degraded;
}

/// What happens to the audio between the file on the server and the speaker —
/// honest about what the app can't know (the phone's audio system does the final mix).
List<SignalStep> signalPath(Song song, UserPreferences? prefs,
    {String device = 'this phone'}) {
  final q = audioQuality(song);
  final t = willTranscode(song, prefs);
  return [
    SignalStep('Source', q.summary.isEmpty ? 'Unknown format' : q.summary),
    if (t != null)
      SignalStep(
        'Delivery',
        'Converted by the server to ${t.format.toUpperCase()}'
            '${t.bitrate != null ? ' at up to ${t.bitrate} kbps' : ''}',
        degraded: q.tier == QualityTier.hires || q.tier == QualityTier.lossless,
      )
    else
      const SignalStep('Delivery', 'Original file, sent unchanged'),
    SignalStep('Playback',
        'Decoded on $device; the system audio output does the final mixing'),
  ];
}

/// Best quality among an album's tracks, for the album header: Hi-Res if any
/// track is, else Lossless if any is, else the shared lossy format. Null when
/// nothing useful can be said (mixed lossy formats, unknown, empty).
AudioQuality? albumQuality(List<Song> songs) {
  if (songs.isEmpty) return null;
  final qualities = songs.map(audioQuality).toList();
  for (final tier in [QualityTier.hires, QualityTier.lossless]) {
    final hits = qualities.where((q) => q.tier == tier).toList();
    if (hits.isNotEmpty) {
      final best = hits.first;
      final summary = hits.length == songs.length
          ? best.summary
          : '${hits.length} of ${songs.length} tracks · ${best.summary}';
      return AudioQuality(best.tier, best.label, summary);
    }
  }
  final labels = qualities.map((q) => q.label).toSet();
  final only = qualities.first;
  if (labels.length != 1 ||
      only.tier == QualityTier.unknown ||
      only.label == null) {
    return null;
  }
  return AudioQuality(only.tier, only.label, only.label!);
}
