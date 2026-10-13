import 'dart:io';

import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/services/download_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

// DownloadService has no public write method that doesn't also require a
// real network download (SubsonicClient.downloadTrack), so rows are seeded
// here by opening a second handle onto the same sqflite_common_ffi-backed
// database file and inserting directly — `service.getDownloads()` is called
// first to make sure the table has actually been created.
Future<File> _seedRow(
  DownloadService service,
  Directory tempDir, {
  required String trackId,
  required bool fileExists,
  DateTime? downloadedAt,
  String? coverLocalPath,
  bool isStandalone = true,
}) async {
  await service.getDownloads();

  final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
  final db = await databaseFactory.openDatabase(dbPath);

  final file = File(p.join(tempDir.path, '$trackId.mp3'));
  if (fileExists) file.writeAsBytesSync([1, 2, 3]);

  await db.insert('downloads', {
    'track_id': trackId,
    'local_path': file.path,
    'title': 'Title $trackId',
    'artist': 'Artist',
    'album': 'Album',
    'cover_art_id': null,
    'cover_local_path': coverLocalPath,
    'file_size': 123,
    'downloaded_at': (downloadedAt ?? DateTime.now()).millisecondsSinceEpoch,
    'is_standalone': isStandalone ? 1 : 0,
  });

  return file;
}

/// Seeds a `downloaded_playlists` row directly, same rationale as
/// [_seedRow] — `downloadPlaylist()` needs a real network client and
/// path_provider, neither available in this plain-Dart test environment.
Future<void> _seedPlaylistRow(
  DownloadService service, {
  required String playlistId,
  String name = 'Playlist',
  String? comment,
  String? coverLocalPath,
  DateTime? downloadedAt,
}) async {
  await service.getDownloads();
  final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
  final db = await databaseFactory.openDatabase(dbPath);
  await db.insert('downloaded_playlists', {
    'playlist_id': playlistId,
    'name': name,
    'comment': comment,
    'cover_local_path': coverLocalPath,
    'downloaded_at': (downloadedAt ?? DateTime.now()).millisecondsSinceEpoch,
  });
}

Future<void> _seedPlaylistMembership(
  DownloadService service, {
  required String playlistId,
  required String trackId,
}) async {
  final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
  final db = await databaseFactory.openDatabase(dbPath);
  await db.insert('playlist_download_tracks',
      {'playlist_id': playlistId, 'track_id': trackId});
}

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late DownloadService service;
  late Directory tempDir;

  setUp(() async {
    // A fresh table for every test — DownloadService always resolves to the
    // same fixed filename under getDatabasesPath(), so a leftover file from
    // a previous test would otherwise leak rows across test cases.
    final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
    await databaseFactory.deleteDatabase(dbPath);
    service = DownloadService();
    tempDir = await Directory.systemTemp.createTemp('riffplayer_dl_test_');
  });

  tearDown(() {
    if (tempDir.existsSync()) tempDir.deleteSync(recursive: true);
  });

  group('getDownloads / localPath / isDownloaded', () {
    test('nothing downloaded yet', () async {
      expect(await service.getDownloads(), isEmpty);
      expect(await service.localPath('missing'), isNull);
      expect(await service.isDownloaded('missing'), isFalse);
    });

    test('finds a downloaded track whose file still exists on disk', () async {
      final file =
          await _seedRow(service, tempDir, trackId: 't1', fileExists: true);

      expect(await service.localPath('t1'), file.path);
      expect(await service.isDownloaded('t1'), isTrue);

      final downloads = await service.getDownloads();
      expect(downloads, hasLength(1));
      expect(downloads.single.trackId, 't1');
      expect(downloads.single.title, 'Title t1');
    });

    test('treats a downloaded track as missing once its file is gone',
        () async {
      await _seedRow(service, tempDir, trackId: 't1', fileExists: false);

      expect(await service.localPath('t1'), isNull);
      expect(await service.isDownloaded('t1'), isFalse);
    });

    test('orders results newest download first', () async {
      await _seedRow(service, tempDir,
          trackId: 'old', fileExists: true, downloadedAt: DateTime(2020));
      await _seedRow(service, tempDir,
          trackId: 'new', fileExists: true, downloadedAt: DateTime(2024));

      final downloads = await service.getDownloads();
      expect(downloads.map((d) => d.trackId), ['new', 'old']);
    });
  });

  group('deleteDownload', () {
    test('removes both the row and the file on disk', () async {
      final file =
          await _seedRow(service, tempDir, trackId: 't1', fileExists: true);

      await service.deleteDownload('t1');

      expect(await service.localPath('t1'), isNull);
      expect(file.existsSync(), isFalse);
    });

    test('is a no-op for a track that was never downloaded', () async {
      await service.deleteDownload('missing');
      expect(await service.getDownloads(), isEmpty);
    });

    test('also removes the cover art file on disk, when there is one',
        () async {
      final coverFile = File(p.join(tempDir.path, 't1_cover.jpg'))
        ..writeAsBytesSync([1, 2, 3]);
      await _seedRow(service, tempDir,
          trackId: 't1', fileExists: true, coverLocalPath: coverFile.path);

      await service.deleteDownload('t1');

      expect(coverFile.existsSync(), isFalse);
    });

    test('does not crash when a track has no cover art file', () async {
      await _seedRow(service, tempDir, trackId: 't1', fileExists: true);
      await service.deleteDownload('t1');
      expect(await service.getDownloads(), isEmpty);
    });
  });

  group('localCoverPath', () {
    test('null for a track with no downloaded cover', () async {
      await _seedRow(service, tempDir, trackId: 't1', fileExists: true);
      expect(await service.localCoverPath('t1'), isNull);
    });

    test('null for a missing track entirely', () async {
      expect(await service.localCoverPath('missing'), isNull);
    });

    test('returns the path when the cover file exists on disk', () async {
      final coverFile = File(p.join(tempDir.path, 't1_cover.jpg'))
        ..writeAsBytesSync([1, 2, 3]);
      await _seedRow(service, tempDir,
          trackId: 't1', fileExists: true, coverLocalPath: coverFile.path);

      expect(await service.localCoverPath('t1'), coverFile.path);
    });

    test('null once the cover file on disk has been removed', () async {
      final coverFile = File(p.join(tempDir.path, 't1_cover.jpg'));
      // Note: not writing the file — same "row references a path, but the
      // file at it is gone" case localPath() already guards against.
      await _seedRow(service, tempDir,
          trackId: 't1', fileExists: true, coverLocalPath: coverFile.path);

      expect(await service.localCoverPath('t1'), isNull);
    });
  });

  group('downloaded playlists', () {
    test('getDownloadedPlaylists is empty with nothing downloaded', () async {
      expect(await service.getDownloadedPlaylists(), isEmpty);
    });

    test('getDownloadedPlaylists reflects track_count from membership rows',
        () async {
      await _seedRow(service, tempDir, trackId: 'a', fileExists: true);
      await _seedRow(service, tempDir, trackId: 'b', fileExists: true);
      await _seedPlaylistRow(service, playlistId: 'p1', name: 'My Mix');
      await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'a');
      await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'b');

      final playlists = await service.getDownloadedPlaylists();

      expect(playlists, hasLength(1));
      expect(playlists.single.playlistId, 'p1');
      expect(playlists.single.name, 'My Mix');
      expect(playlists.single.trackCount, 2);
    });

    test('getDownloadedPlaylists orders newest download first', () async {
      await _seedPlaylistRow(service,
          playlistId: 'old', name: 'Old', downloadedAt: DateTime(2020));
      await _seedPlaylistRow(service,
          playlistId: 'new', name: 'New', downloadedAt: DateTime(2024));

      final playlists = await service.getDownloadedPlaylists();

      expect(playlists.map((p) => p.playlistId), ['new', 'old']);
    });

    test('getDownloadedPlaylists carries the comment/description through',
        () async {
      await _seedPlaylistRow(service,
          playlistId: 'p1', name: 'Mix', comment: 'A great mix');

      final playlists = await service.getDownloadedPlaylists();

      expect(playlists.single.comment, 'A great mix');
    });

    test('getDownloadedPlaylist returns null for a playlist never downloaded',
        () async {
      expect(await service.getDownloadedPlaylist('missing'), isNull);
    });

    test('getDownloadedPlaylist finds one playlist by id', () async {
      await _seedPlaylistRow(service, playlistId: 'p1', name: 'Mix');
      await _seedPlaylistRow(service, playlistId: 'p2', name: 'Other');

      final playlist = await service.getDownloadedPlaylist('p1');

      expect(playlist, isNotNull);
      expect(playlist!.name, 'Mix');
    });

    test(
        'getDownloadedPlaylistTracks scopes to just that playlist\'s '
        'membership', () async {
      await _seedRow(service, tempDir, trackId: 'a', fileExists: true);
      await _seedRow(service, tempDir, trackId: 'b', fileExists: true);
      await _seedRow(service, tempDir, trackId: 'c', fileExists: true);
      await _seedPlaylistRow(service, playlistId: 'p1', name: 'Mix');
      await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'a');
      await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'b');
      // 'c' is downloaded but never part of p1.

      final tracks = await service.getDownloadedPlaylistTracks('p1');

      expect(tracks.map((t) => t.trackId).toSet(), {'a', 'b'});
    });

    group('deleteDownloadedPlaylist', () {
      test('removes the playlist row, its membership rows, and its cover',
          () async {
        final coverFile = File(p.join(tempDir.path, 'p1_cover.jpg'))
          ..writeAsBytesSync([1, 2, 3]);
        await _seedPlaylistRow(service,
            playlistId: 'p1', coverLocalPath: coverFile.path);

        await service.deleteDownloadedPlaylist('p1');

        expect(await service.getDownloadedPlaylist('p1'), isNull);
        expect(coverFile.existsSync(), isFalse);
      });

      test(
          'deletes a member track that was only ever downloaded through this '
          'playlist', () async {
        final trackFile = await _seedRow(service, tempDir,
            trackId: 'a', fileExists: true, isStandalone: false);
        await _seedPlaylistRow(service, playlistId: 'p1');
        await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'a');

        await service.deleteDownloadedPlaylist('p1');

        expect(await service.localPath('a'), isNull);
        expect(trackFile.existsSync(), isFalse);
      });

      test(
          'keeps a member track that was also downloaded standalone '
          '(regression: the exact scenario the user asked for)', () async {
        final trackFile = await _seedRow(service, tempDir,
            trackId: 'a', fileExists: true, isStandalone: true);
        await _seedPlaylistRow(service, playlistId: 'p1');
        await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'a');

        await service.deleteDownloadedPlaylist('p1');

        expect(await service.localPath('a'), trackFile.path);
        expect(trackFile.existsSync(), isTrue);
      });

      test('keeps a member track that is also in another downloaded playlist',
          () async {
        final trackFile = await _seedRow(service, tempDir,
            trackId: 'a', fileExists: true, isStandalone: false);
        await _seedPlaylistRow(service, playlistId: 'p1');
        await _seedPlaylistRow(service, playlistId: 'p2');
        await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'a');
        await _seedPlaylistMembership(service, playlistId: 'p2', trackId: 'a');

        await service.deleteDownloadedPlaylist('p1');

        expect(await service.localPath('a'), trackFile.path);
        // p1's membership is gone, but the track is still p2's.
        expect(await service.getDownloadedPlaylistTracks('p1'), isEmpty);
        expect(
            (await service.getDownloadedPlaylistTracks('p2'))
                .map((t) => t.trackId),
            ['a']);
      });

      test('is a no-op for a playlist that was never downloaded', () async {
        await service.deleteDownloadedPlaylist('missing');
        expect(await service.getDownloadedPlaylists(), isEmpty);
      });
    });
  });

  // Regression coverage for the downloads table schema migration (v1 -> v2,
  // adding cover_local_path): a real device with tracks already downloaded
  // under the old schema must not lose them, or crash, on first launch
  // after the update.
  group('schema migration', () {
    test(
        'upgrading from the pre-cover-art schema (v1) preserves existing '
        'rows and makes cover_local_path usable', () async {
      final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
      final v1Db = await databaseFactory.openDatabase(
        dbPath,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: (db, _) => db.execute('''
            CREATE TABLE downloads (
              track_id   TEXT PRIMARY KEY,
              local_path TEXT NOT NULL,
              title      TEXT NOT NULL,
              artist     TEXT NOT NULL,
              album      TEXT NOT NULL,
              cover_art_id TEXT,
              file_size  INTEGER,
              downloaded_at INTEGER NOT NULL
            )
          '''),
        ),
      );
      final file = File(p.join(tempDir.path, 'old.mp3'))
        ..writeAsBytesSync([1, 2, 3]);
      await v1Db.insert('downloads', {
        'track_id': 'old',
        'local_path': file.path,
        'title': 'Pre-migration track',
        'artist': 'Artist',
        'album': 'Album',
        'cover_art_id': null,
        'file_size': 3,
        'downloaded_at': DateTime.now().millisecondsSinceEpoch,
      });
      await v1Db.close();

      // DownloadService opens at version 2 — triggers onUpgrade.
      final downloads = await service.getDownloads();

      expect(downloads, hasLength(1));
      expect(downloads.single.trackId, 'old');
      expect(downloads.single.title, 'Pre-migration track');
      expect(downloads.single.coverLocalPath, isNull);
      // The new column must be genuinely queryable now, not just absent
      // from the migrated row by coincidence.
      expect(await service.localCoverPath('old'), isNull);
    });

    test(
        'upgrading from the pre-playlist-downloads schema (v2) preserves '
        'existing rows, treats them as standalone, and makes the playlist '
        'tables usable', () async {
      final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
      final v2Db = await databaseFactory.openDatabase(
        dbPath,
        options: OpenDatabaseOptions(
          version: 2,
          onCreate: (db, _) => db.execute('''
            CREATE TABLE downloads (
              track_id   TEXT PRIMARY KEY,
              local_path TEXT NOT NULL,
              title      TEXT NOT NULL,
              artist     TEXT NOT NULL,
              album      TEXT NOT NULL,
              cover_art_id TEXT,
              cover_local_path TEXT,
              file_size  INTEGER,
              downloaded_at INTEGER NOT NULL
            )
          '''),
        ),
      );
      final file = File(p.join(tempDir.path, 'old.mp3'))
        ..writeAsBytesSync([1, 2, 3]);
      await v2Db.insert('downloads', {
        'track_id': 'old',
        'local_path': file.path,
        'title': 'Pre-migration track',
        'artist': 'Artist',
        'album': 'Album',
        'cover_art_id': null,
        'cover_local_path': null,
        'file_size': 3,
        'downloaded_at': DateTime.now().millisecondsSinceEpoch,
      });
      await v2Db.close();

      // DownloadService opens at version 3 — triggers onUpgrade.
      final downloads = await service.getDownloads();

      expect(downloads, hasLength(1));
      expect(downloads.single.trackId, 'old');
      // A pre-existing download predates playlist grouping entirely, so it
      // must count as standalone — otherwise deleting a downloaded playlist
      // that happens to also reference this track id would wrongly delete
      // a file the user downloaded before playlist-downloads even existed.
      await _seedPlaylistRow(service, playlistId: 'p1');
      await _seedPlaylistMembership(service, playlistId: 'p1', trackId: 'old');
      await service.deleteDownloadedPlaylist('p1');
      expect(await service.localPath('old'), file.path);
      expect(file.existsSync(), isTrue);
    });
  });

  group('lyrics', () {
    const synced = Lyrics(synced: true, line: [
      LyricsLine(start: 1000, value: 'first line'),
      LyricsLine(start: 4500, value: 'second line'),
    ]);

    test('a downloaded track has no lyrics until some are saved', () async {
      await _seedRow(service, tempDir, trackId: 'a', fileExists: true);
      expect(await service.localLyrics('a'), isNull);
      expect(await service.localLyrics('missing'), isNull);
    });

    test('saved lyrics come back intact, including timing', () async {
      await _seedRow(service, tempDir, trackId: 'a', fileExists: true);

      await service.saveLyrics('a', synced);
      final back = await service.localLyrics('a');

      expect(back, isNotNull);
      expect(back!.synced, isTrue);
      expect(back.line.map((l) => (l.start, l.value)),
          [(1000, 'first line'), (4500, 'second line')]);
    });

    test('lyrics go away with the download', () async {
      await _seedRow(service, tempDir, trackId: 'a', fileExists: true);
      await service.saveLyrics('a', synced);

      await service.deleteDownload('a');

      expect(await service.localLyrics('a'), isNull);
    });

    test(
        'upgrading from the pre-lyrics schema (v3) keeps existing rows and '
        'makes lyrics storable', () async {
      final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
      final v3Db = await databaseFactory.openDatabase(
        dbPath,
        options: OpenDatabaseOptions(
          version: 3,
          onCreate: (db, _) async {
            await db.execute('''
              CREATE TABLE downloads (
                track_id   TEXT PRIMARY KEY,
                local_path TEXT NOT NULL,
                title      TEXT NOT NULL,
                artist     TEXT NOT NULL,
                album      TEXT NOT NULL,
                cover_art_id TEXT,
                cover_local_path TEXT,
                file_size  INTEGER,
                downloaded_at INTEGER NOT NULL,
                is_standalone INTEGER NOT NULL DEFAULT 1
              )
            ''');
            await db.execute('''
              CREATE TABLE downloaded_playlists (
                playlist_id TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                comment     TEXT,
                cover_local_path TEXT,
                downloaded_at INTEGER NOT NULL
              )
            ''');
            await db.execute('''
              CREATE TABLE playlist_download_tracks (
                playlist_id TEXT NOT NULL,
                track_id    TEXT NOT NULL,
                PRIMARY KEY (playlist_id, track_id)
              )
            ''');
          },
        ),
      );
      final file = File(p.join(tempDir.path, 'old.mp3'))
        ..writeAsBytesSync([1, 2, 3]);
      await v3Db.insert('downloads', {
        'track_id': 'old',
        'local_path': file.path,
        'title': 'Pre-lyrics track',
        'artist': 'Artist',
        'album': 'Album',
        'file_size': 3,
        'downloaded_at': DateTime.now().millisecondsSinceEpoch,
      });
      await v3Db.close();

      final downloads = await service.getDownloads();

      expect(downloads.single.title, 'Pre-lyrics track');
      expect(await service.localLyrics('old'), isNull);
      await service.saveLyrics('old', synced);
      expect((await service.localLyrics('old'))!.line, hasLength(2));
    });
  });
}
