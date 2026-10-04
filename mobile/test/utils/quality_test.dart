import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/utils/quality.dart';

Song _song({
  String suffix = 'mp3',
  bool? lossless,
  int? bitDepth,
  int? samplingRate,
  int? channelCount,
  int? bitRate,
  String? codec,
}) =>
    Song(
      id: '1',
      title: 't',
      artist: 'a',
      artistId: 'x',
      album: 'al',
      albumId: 'y',
      suffix: suffix,
      lossless: lossless,
      bitDepth: bitDepth,
      samplingRate: samplingRate,
      channelCount: channelCount,
      bitRate: bitRate,
      codec: codec,
    );

void main() {
  group('audioQuality', () {
    test('24-bit lossless is Hi-Res and described in full', () {
      final q = audioQuality(_song(
          suffix: 'flac',
          lossless: true,
          bitDepth: 24,
          samplingRate: 96000,
          channelCount: 2,
          bitRate: 2304));
      expect(q.tier, QualityTier.hires);
      expect(q.label, 'Hi-Res');
      expect(q.summary, 'FLAC · 24-bit / 96 kHz · Stereo · 2304 kbps');
    });

    test('CD-quality lossless is plain Lossless', () {
      expect(
          audioQuality(_song(
                  suffix: 'flac',
                  lossless: true,
                  bitDepth: 16,
                  samplingRate: 44100))
              .tier,
          QualityTier.lossless);
      expect(
          audioQuality(_song(
                  suffix: 'wav',
                  lossless: true,
                  bitDepth: 16,
                  samplingRate: 48000))
              .tier,
          QualityTier.lossless);
    });

    test('24-bit at 44.1 kHz and 16-bit above 48 kHz both count as Hi-Res', () {
      expect(
          audioQuality(_song(
                  suffix: 'flac',
                  lossless: true,
                  bitDepth: 24,
                  samplingRate: 44100))
              .tier,
          QualityTier.hires);
      expect(
          audioQuality(_song(
                  suffix: 'flac',
                  lossless: true,
                  bitDepth: 16,
                  samplingRate: 88200))
              .tier,
          QualityTier.hires);
    });

    test('a lossy file is labelled by its format', () {
      final q = audioQuality(_song(
          suffix: 'mp3',
          lossless: false,
          samplingRate: 44100,
          channelCount: 2,
          bitRate: 320));
      expect(q.tier, QualityTier.lossy);
      expect(q.label, 'MP3');
      expect(q.summary, 'MP3 · 44.1 kHz · Stereo · 320 kbps');
    });

    test('falls back to the extension, without guessing for m4a', () {
      expect(audioQuality(_song(suffix: 'flac')).tier, QualityTier.lossless);
      expect(audioQuality(_song(suffix: 'ogg')).tier, QualityTier.lossy);
      expect(audioQuality(_song(suffix: 'm4a')).tier, QualityTier.unknown);
    });

    test('a long codec name does not replace the short format in the summary',
        () {
      final q = audioQuality(
          _song(suffix: 'mp3', codec: 'MPEG 1 Layer 3', lossless: false));
      expect(q.summary.startsWith('MP3'), isTrue);
    });
  });

  group('willTranscode', () {
    final flac = _song(suffix: 'flac', bitRate: 900);

    test('never without preferences', () {
      expect(willTranscode(flac, null), isNull);
      expect(willTranscode(flac, const UserPreferences()), isNull);
    });

    test('when the preferred format differs from the file', () {
      final t =
          willTranscode(flac, const UserPreferences(transcodeFormat: 'mp3'));
      expect(t?.format, 'mp3');
    });

    test('not when the file already is that format, or "raw"', () {
      expect(
          willTranscode(flac, const UserPreferences(transcodeFormat: 'flac')),
          isNull);
      expect(willTranscode(flac, const UserPreferences(transcodeFormat: 'raw')),
          isNull);
    });

    test('when over the bitrate cap, not when under it', () {
      expect(
          willTranscode(flac, const UserPreferences(transcodeBitrate: 320))
              ?.bitrate,
          320);
      expect(
          willTranscode(_song(suffix: 'mp3', bitRate: 192),
              const UserPreferences(transcodeBitrate: 320)),
          isNull);
    });
  });

  group('signalPath', () {
    final flac = _song(
        suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 96000);

    test('source, delivery, playback — and unchanged when nothing converts',
        () {
      final steps = signalPath(flac, null);
      expect(steps.map((s) => s.stage), ['Source', 'Delivery', 'Playback']);
      expect(steps[1].text, 'Original file, sent unchanged');
      expect(steps[1].degraded, isFalse);
    });

    test('flags a conversion of a lossless file as lowering quality', () {
      final steps = signalPath(
          flac,
          const UserPreferences(
              transcodeFormat: 'opus', transcodeBitrate: 128));
      expect(steps[1].text, contains('OPUS at up to 128 kbps'));
      expect(steps[1].degraded, isTrue);
    });
  });

  group('albumQuality', () {
    final hi = _song(
        suffix: 'flac', lossless: true, bitDepth: 24, samplingRate: 96000);
    final cd = _song(
        suffix: 'flac', lossless: true, bitDepth: 16, samplingRate: 44100);
    final mp3 = _song(suffix: 'mp3', lossless: false);

    test('Hi-Res when any track is, with how many', () {
      final q = albumQuality([hi, cd, mp3]);
      expect(q?.tier, QualityTier.hires);
      expect(q?.summary, contains('1 of 3 tracks'));
    });

    test('Lossless when some tracks are lossless but none Hi-Res', () {
      expect(albumQuality([cd, mp3])?.tier, QualityTier.lossless);
    });

    test('the format when every track is the same lossy format', () {
      expect(albumQuality([mp3, mp3])?.label, 'MP3');
    });

    test('nothing for mixed lossy formats, unknowns or an empty album', () {
      expect(
          albumQuality([mp3, _song(suffix: 'ogg', lossless: false)]), isNull);
      expect(albumQuality([_song(suffix: 'm4a')]), isNull);
      expect(albumQuality([]), isNull);
    });
  });
}
