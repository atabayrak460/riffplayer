import 'package:audio_service/audio_service.dart';
import 'package:riffplayer_mobile/api/subsonic.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/audio/audio_handler.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:mocktail/mocktail.dart';

import '../helpers/mocks.dart';

const _creds = Credentials(
  serverUrl: 'http://example.com:4533',
  username: 'alice',
  password: 'hunter2',
);

Song _song(
  String id, {
  String? coverArt,
  int? duration,
  double? replayGainTrackGain,
  double? replayGainAlbumGain,
}) =>
    Song(
      id: id,
      title: 'Title $id',
      artist: 'Artist',
      artistId: 'artist-1',
      album: 'Album',
      albumId: 'album-1',
      suffix: 'mp3',
      coverArt: coverArt,
      duration: duration,
      replayGainTrackGain: replayGainTrackGain,
      replayGainAlbumGain: replayGainAlbumGain,
    );

void main() {
  setUpAll(registerMockFallbackValues);

  final client = SubsonicClient(_creds);

  group('songToMediaItem', () {
    test('maps the basic fields straight across', () {
      final song = _song('t1', duration: 200);
      final item = songToMediaItem(song, client);

      expect(item.id, 't1');
      expect(item.title, song.title);
      expect(item.artist, song.artist);
      expect(item.album, song.album);
      expect(item.duration, const Duration(seconds: 200));
    });

    test('duration is null when the song has none', () {
      final song = _song('t1', duration: null);
      expect(songToMediaItem(song, client).duration, isNull);
    });

    test('artUri is null when there is no cover art', () {
      final song = _song('t1', coverArt: null);
      expect(songToMediaItem(song, client).artUri, isNull);
    });

    test('artUri is built from the client when cover art is present', () {
      final song = _song('t1', coverArt: 'cover-1');
      final uri = songToMediaItem(song, client).artUri;

      expect(uri, isNotNull);
      expect(uri!.queryParameters['id'], 'cover-1');
      expect(uri.queryParameters['size'], '300');
    });

    test('carries replayGainTrackGain and songId through extras', () {
      final song = _song('t1', replayGainTrackGain: -4.5);
      final extras = songToMediaItem(song, client).extras!;

      expect(extras['replayGainTrackGain'], -4.5);
      expect(extras['songId'], 't1');
    });

    test('also carries the album gain, for ReplayGain album mode', () {
      final song = _song('t1', replayGainAlbumGain: -3.2);
      expect(
          songToMediaItem(song, client).extras!['replayGainAlbumGain'], -3.2);
    });

    test('prefers a local cover path over the network coverArtUrl', () {
      final song = _song('t1', coverArt: 'cover-1');

      final item = songToMediaItem(song, client,
          localCoverPath: '/downloads/covers/t1.jpg');

      expect(item.artUri, Uri.file('/downloads/covers/t1.jpg'));
    });

    test('falls back to the network coverArtUrl with no local cover path', () {
      final song = _song('t1', coverArt: 'cover-1');

      final item = songToMediaItem(song, client);

      expect(item.artUri!.scheme, 'http');
      expect(item.artUri!.queryParameters['id'], 'cover-1');
    });
  });

  group('buildAudioSource', () {
    late MockDownloadService downloads;

    setUp(() {
      downloads = MockDownloadService();
    });

    test('streams from the server when the song is not downloaded', () async {
      when(() => downloads.localPath(any())).thenAnswer((_) async => null);
      final song = _song('t1');

      final source = await buildAudioSource(song, client, downloads);

      expect(source.sequence, hasLength(1));
      final uri = (source.sequence.single as UriAudioSource).uri;
      expect(uri.scheme, 'http');
      expect(uri.queryParameters['id'], 't1');
    });

    test('plays the local file when the song is downloaded', () async {
      when(() => downloads.localPath('t1'))
          .thenAnswer((_) async => '/downloads/t1.mp3');
      when(() => downloads.localCoverPath('t1')).thenAnswer((_) async => null);
      final song = _song('t1');

      final source = await buildAudioSource(song, client, downloads);

      final uri = (source.sequence.single as UriAudioSource).uri;
      expect(uri, Uri.file('/downloads/t1.mp3'));
    });

    // Regression coverage for the offline lock-screen/notification artwork
    // fix: a downloaded track's cached cover file should end up as the
    // MediaItem's artUri, not a network coverArtUrl that would fail to load
    // offline.
    test(
        'uses the downloaded cover file for lock-screen art when the song is downloaded',
        () async {
      when(() => downloads.localPath('t1'))
          .thenAnswer((_) async => '/downloads/t1.mp3');
      when(() => downloads.localCoverPath('t1'))
          .thenAnswer((_) async => '/downloads/covers/t1.jpg');
      final song = _song('t1', coverArt: 'cover-1');

      final source = await buildAudioSource(song, client, downloads);

      final tag = (source.sequence.single as UriAudioSource).tag as MediaItem;
      expect(tag.artUri, Uri.file('/downloads/covers/t1.jpg'));
    });

    test(
        'does not even check for a local cover when the song is not downloaded',
        () async {
      when(() => downloads.localPath('t1')).thenAnswer((_) async => null);
      final song = _song('t1', coverArt: 'cover-1');

      await buildAudioSource(song, client, downloads);

      verifyNever(() => downloads.localCoverPath(any()));
    });
  });
}
