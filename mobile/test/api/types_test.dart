import 'package:riffplayer_mobile/api/types.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  importedHistoryTests();
  group('Credentials', () {
    test('copyWith replaces only the token, keeping everything else', () {
      const original = Credentials(
        serverUrl: 'http://s',
        username: 'u',
        password: 'p',
      );
      final updated = original.copyWith(token: 'jwt-1');

      expect(updated.serverUrl, 'http://s');
      expect(updated.username, 'u');
      expect(updated.password, 'p');
      expect(updated.token, 'jwt-1');
    });

    test('copyWith with no arguments keeps the existing token', () {
      const original = Credentials(
        serverUrl: 'http://s',
        username: 'u',
        password: 'p',
        token: 'jwt-1',
      );
      expect(original.copyWith().token, 'jwt-1');
    });
  });

  group('Artist.fromJson', () {
    test('parses a full response', () {
      final artist = Artist.fromJson({
        'id': 'a1',
        'name': 'Artist One',
        'albumCount': 5,
        'coverArt': 'cover-1',
        'starred': '2024-01-01T00:00:00Z',
      });

      expect(artist.id, 'a1');
      expect(artist.name, 'Artist One');
      expect(artist.albumCount, 5);
      expect(artist.isStarred, isTrue);
    });

    test('defaults missing optional fields', () {
      final artist = Artist.fromJson({'id': 'a1', 'name': 'Artist One'});
      expect(artist.albumCount, 0);
      expect(artist.coverArt, isNull);
      expect(artist.isStarred, isFalse);
    });
  });

  group('ArtistIndex.fromJson', () {
    test('parses nested artists, defaulting to an empty list when absent', () {
      final withArtists = ArtistIndex.fromJson({
        'name': 'A',
        'artist': [
          {'id': 'a1', 'name': 'Artist One'},
        ],
      });
      expect(withArtists.artists, hasLength(1));
      expect(withArtists.artists.single.id, 'a1');

      final withoutArtists = ArtistIndex.fromJson({'name': 'B'});
      expect(withoutArtists.artists, isEmpty);
    });
  });

  group('Album.fromJson', () {
    test('parses a full response', () {
      final album = Album.fromJson({
        'id': 'al1',
        'name': 'Album One',
        'artist': 'Artist One',
        'artistId': 'a1',
        'year': 2020,
        'coverArt': 'cover-1',
        'songCount': 12,
        'duration': 3600,
        'starred': '2024-01-01T00:00:00Z',
      });

      expect(album.year, 2020);
      expect(album.songCount, 12);
      expect(album.isStarred, isTrue);
    });

    test('defaults missing fields to empty strings / zero', () {
      final album = Album.fromJson({'id': 'al1', 'name': 'Album One'});
      expect(album.artist, '');
      expect(album.artistId, '');
      expect(album.songCount, 0);
      expect(album.duration, 0);
      expect(album.year, isNull);
      expect(album.isStarred, isFalse);
    });
  });

  group('Song.fromJson / withStarred', () {
    Map<String, dynamic> fullJson() => {
          'id': 't1',
          'title': 'Track One',
          'artist': 'Artist One',
          'artistId': 'a1',
          'album': 'Album One',
          'albumId': 'al1',
          'track': 3,
          'discNumber': 1,
          'year': 2020,
          'duration': 210,
          'size': 5000000,
          'coverArt': 'cover-1',
          'suffix': 'flac',
          'starred': '2024-01-01T00:00:00Z',
          'replayGainTrackGain': -3.2,
          'created': '2023-06-15T12:00:00Z',
          'bitRate': 320,
          'playCount': 7,
        };

    test('parses every field from a full response', () {
      final song = Song.fromJson(fullJson());

      expect(song.id, 't1');
      expect(song.track, 3);
      expect(song.discNumber, 1);
      expect(song.year, 2020);
      expect(song.duration, 210);
      expect(song.size, 5000000);
      expect(song.suffix, 'flac');
      expect(song.isStarred, isTrue);
      expect(song.replayGainTrackGain, -3.2);
      expect(song.created, DateTime.tryParse('2023-06-15T12:00:00Z'));
      expect(song.bitRate, 320);
      expect(song.playCount, 7);
    });

    test('defaults artist/album/suffix when missing, suffix falls back to mp3',
        () {
      final song = Song.fromJson({'id': 't1', 'title': 'Track One'});

      expect(song.artist, '');
      expect(song.album, '');
      expect(song.suffix, 'mp3');
      expect(song.isStarred, isFalse);
      expect(song.created, isNull);
    });

    test('withStarred replaces only the starred field', () {
      final song = Song.fromJson(fullJson());
      final starred = song.withStarred('2025-01-01T00:00:00Z');
      final unstarred = song.withStarred(null);

      expect(starred.isStarred, isTrue);
      expect(unstarred.isStarred, isFalse);
      // Everything else survives the round-trip untouched.
      expect(starred.id, song.id);
      expect(starred.replayGainTrackGain, song.replayGainTrackGain);
      expect(starred.created, song.created);
    });
  });

  group('Playlist.fromJson', () {
    test('parses nested song entries', () {
      final playlist = Playlist.fromJson({
        'id': 'p1',
        'name': 'My Playlist',
        'owner': 'alice',
        'songCount': 1,
        'duration': 210,
        'entry': [
          {'id': 't1', 'title': 'Track One'},
        ],
      });

      expect(playlist.entries, hasLength(1));
      expect(playlist.entries!.single.id, 't1');
    });

    test('entries is null when there is no entry key at all', () {
      final playlist = Playlist.fromJson({'id': 'p1', 'name': 'Empty'});
      expect(playlist.entries, isNull);
      expect(playlist.owner, '');
    });
  });

  group('Lyrics.fromJson', () {
    test('parses synced lines in order', () {
      final lyrics = Lyrics.fromJson({
        'synced': true,
        'line': [
          {'start': 0, 'value': 'first'},
          {'start': 1500, 'value': 'second'},
        ],
      });

      expect(lyrics.synced, isTrue);
      expect(lyrics.line.map((l) => l.value), ['first', 'second']);
      expect(lyrics.line[1].start, 1500);
    });

    test('defaults to unsynced with no lines when absent', () {
      final lyrics = Lyrics.fromJson({});
      expect(lyrics.synced, isFalse);
      expect(lyrics.line, isEmpty);
    });
  });

  group('MeInfo.fromJson', () {
    test('isAdmin reflects the role field', () {
      final admin =
          MeInfo.fromJson({'id': 1, 'username': 'alice', 'role': 'admin'});
      final user =
          MeInfo.fromJson({'id': 2, 'username': 'bob', 'role': 'user'});

      expect(admin.isAdmin, isTrue);
      expect(user.isAdmin, isFalse);
    });

    test('parses nested preferences when present, null when absent', () {
      final withPrefs = MeInfo.fromJson({
        'id': 1,
        'username': 'alice',
        'role': 'user',
        'preferences': {
          'transcode_format': 'opus',
          'transcode_bitrate': 128,
        },
      });
      expect(withPrefs.preferences?.transcodeFormat, 'opus');
      expect(withPrefs.preferences?.transcodeBitrate, 128);

      final withoutPrefs =
          MeInfo.fromJson({'id': 1, 'username': 'alice', 'role': 'user'});
      expect(withoutPrefs.preferences, isNull);
    });
  });

  group('LibrarySidebarItem.fromJson', () {
    test('parses pinnedAt when present', () {
      final item = LibrarySidebarItem.fromJson({
        'itemType': 'playlist',
        'itemKey': 'p1',
        'pinnedAt': '2024-05-01T00:00:00Z',
        'lastInteractedAt': '2024-06-01T00:00:00Z',
      });

      expect(item.pinnedAt, DateTime.tryParse('2024-05-01T00:00:00Z'));
      expect(item.lastInteractedAt, DateTime.tryParse('2024-06-01T00:00:00Z'));
    });

    test('pinnedAt is null when absent from the response', () {
      final item = LibrarySidebarItem.fromJson({
        'itemType': 'system',
        'itemKey': 'favorites',
        // lastInteractedAt is treated as always-present (it's a required,
        // non-nullable field) — unlike pinnedAt, there's no null check
        // before parsing it, only a fallback for an unparseable value.
        'lastInteractedAt': '2024-06-01T00:00:00Z',
      });

      expect(item.pinnedAt, isNull);
    });

    test('lastInteractedAt falls back to epoch when it fails to parse', () {
      final item = LibrarySidebarItem.fromJson({
        'itemType': 'system',
        'itemKey': 'favorites',
        'lastInteractedAt': 'not-a-real-date',
      });

      expect(item.lastInteractedAt, DateTime.fromMillisecondsSinceEpoch(0));
    });
  });

  group('WrappedStats.fromJson', () {
    test('parses nested topTracks/topArtists/byMonth', () {
      final stats = WrappedStats.fromJson({
        'year': 2024,
        'totalPlays': 500,
        'totalMinutes': 12000,
        'topTracks': [
          {
            'id': 't1',
            'title': 'Track One',
            'playCount': 42,
          },
        ],
        'topArtists': [
          {'id': 'a1', 'name': 'Artist One', 'playCount': 100},
        ],
        'byMonth': [
          {'month': 1, 'plays': 10},
          {'month': 2, 'plays': 20},
        ],
      });

      expect(stats.year, 2024);
      expect(stats.topTracks.single.playCount, 42);
      expect(stats.topArtists.single.name, 'Artist One');
      expect(stats.byMonth.map((m) => m.plays), [10, 20]);
    });

    test('defaults every list to empty and counts to zero when absent', () {
      final stats = WrappedStats.fromJson({'year': 2024});

      expect(stats.totalPlays, 0);
      expect(stats.totalMinutes, 0);
      expect(stats.topTracks, isEmpty);
      expect(stats.topArtists, isEmpty);
      expect(stats.byMonth, isEmpty);
    });
  });
}

void importedHistoryTests() {
  group('imported listening history', () {
    test('Wrapped marks songs that are not in the library', () {
      final w = WrappedStats.fromJson({
        'year': 2023,
        'totalPlays': 3,
        'totalMinutes': 10,
        'importedPlays': 2,
        'topTracks': [
          {
            'id': '',
            'title': 'Elsewhere',
            'artist': 'Far Band',
            'coverArt': null,
            'playCount': 2,
            'external': true
          },
          {'id': '7', 'title': 'Here', 'playCount': 1},
        ],
        'topArtists': [
          {'id': '', 'name': 'Far Band', 'playCount': 2, 'external': true},
        ],
        'byMonth': [],
      });
      expect(w.importedPlays, 2);
      expect(w.topTracks[0].external, isTrue);
      expect(w.topTracks[1].external, isFalse);
      expect(w.topArtists.single.external, isTrue);
    });

    test('an older server\'s Wrapped still parses', () {
      final w = WrappedStats.fromJson(
          {'year': 2023, 'totalPlays': 0, 'totalMinutes': 0});
      expect(w.importedPlays, 0);
    });

    test('an import result reads as a sentence', () {
      expect(
          const ImportOutcome(source: 'apple_music', added: 4, duplicates: 0)
              .message,
          '4 plays added from Apple Music.');
      expect(
          const ImportOutcome(
                  source: 'lastfm', added: 1, duplicates: 3, truncated: true)
              .message,
          startsWith(
              '1 plays added from Last.fm, 3 already counted, only the first part'));
    });
  });
}
