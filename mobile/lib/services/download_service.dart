import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:dio/dio.dart';
import '../api/types.dart';
import '../api/subsonic.dart';

typedef DownloadProgress = void Function(int received, int total);

// Constructed exactly once via downloadServiceProvider (a plain Riverpod
// Provider, so effectively a singleton for the app's lifetime) — state lives
// on the instance rather than as static fields so nothing else can assume
// (or accidentally rely on) every DownloadService sharing one global state.
class DownloadService {
  Database? _db;
  final Map<String, CancelToken> _activeDownloads = {};

  // ── Database ────────────────────────────────────────────────────────────────

  Future<Database> get _database async {
    if (_db != null) return _db!;
    final dbPath = p.join(await getDatabasesPath(), 'cadence_downloads.db');
    _db = await openDatabase(
      dbPath,
      version: 4,
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
            is_standalone INTEGER NOT NULL DEFAULT 1,
            lyrics_json TEXT
          )
        ''');
        await _createPlaylistTables(db);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute(
              'ALTER TABLE downloads ADD COLUMN cover_local_path TEXT');
        }
        if (oldVersion < 3) {
          await _createPlaylistTables(db);
          // Every pre-existing download predates playlist grouping, so it
          // was necessarily a standalone one — DEFAULT 1 covers both these
          // existing rows and the column's default for future inserts.
          await db.execute(
              'ALTER TABLE downloads ADD COLUMN is_standalone INTEGER NOT NULL DEFAULT 1');
        }
        if (oldVersion < 4) {
          // Lyrics saved with the track so they show offline. Songs
          // downloaded before this have none until they are first opened
          // online (see lyricsProvider).
          await db.execute('ALTER TABLE downloads ADD COLUMN lyrics_json TEXT');
        }
      },
    );
    return _db!;
  }

  Future<void> _createPlaylistTables(DatabaseExecutor db) async {
    await db.execute('''
      CREATE TABLE downloaded_playlists (
        playlist_id TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        comment     TEXT,
        cover_local_path TEXT,
        downloaded_at INTEGER NOT NULL
      )
    ''');
    // A track can belong to more than one downloaded playlist (or none, if
    // downloaded individually) — hence a join table rather than a column on
    // `downloads`. No foreign key to `downloads.track_id`: the track row and
    // this membership row are written in the same downloadPlaylist() call,
    // but sqflite's default pragma has foreign_keys off, so this is purely
    // an app-level invariant, checked at query time instead.
    await db.execute('''
      CREATE TABLE playlist_download_tracks (
        playlist_id TEXT NOT NULL,
        track_id    TEXT NOT NULL,
        PRIMARY KEY (playlist_id, track_id)
      )
    ''');
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  Future<List<DownloadedTrack>> getDownloads() async {
    final db = await _database;
    final rows = await db.query('downloads', orderBy: 'downloaded_at DESC');
    return rows.map(_rowToTrack).toList();
  }

  Future<String?> localPath(String trackId) async {
    final db = await _database;
    final rows = await db.query('downloads',
        columns: ['local_path'], where: 'track_id = ?', whereArgs: [trackId]);
    if (rows.isEmpty) return null;
    final path = rows.first['local_path'] as String;
    return File(path).existsSync() ? path : null;
  }

  /// The locally-saved cover art for a downloaded track, if it has one and
  /// the fetch succeeded — used for offline display (Downloads screen,
  /// lock-screen/notification artwork) instead of a live network fetch.
  Future<String?> localCoverPath(String trackId) async {
    final db = await _database;
    final rows = await db.query('downloads',
        columns: ['cover_local_path'],
        where: 'track_id = ?',
        whereArgs: [trackId]);
    if (rows.isEmpty) return null;
    final path = rows.first['cover_local_path'] as String?;
    if (path == null) return null;
    return File(path).existsSync() ? path : null;
  }

  Future<bool> isDownloaded(String trackId) async =>
      (await localPath(trackId)) != null;

  /// The lyrics saved with a downloaded track, if any.
  Future<Lyrics?> localLyrics(String trackId) async {
    final db = await _database;
    final rows = await db.query('downloads',
        columns: ['lyrics_json'], where: 'track_id = ?', whereArgs: [trackId]);
    final json = rows.isEmpty ? null : rows.first['lyrics_json'] as String?;
    if (json == null) return null;
    try {
      return Lyrics.fromJson(jsonDecode(json) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  /// Stores [lyrics] for an already-downloaded track (songs downloaded before
  /// lyrics were saved pick theirs up the first time they are shown online).
  Future<void> saveLyrics(String trackId, Lyrics lyrics) async {
    final db = await _database;
    await db.update('downloads', {'lyrics_json': jsonEncode(lyrics.toJson())},
        where: 'track_id = ?', whereArgs: [trackId]);
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  /// [standalone] marks whether this call itself represents the user
  /// explicitly wanting this *individual* track offline — true for every
  /// normal call site (a song's own "Download" action). [downloadPlaylist]
  /// passes false for the tracks it downloads as part of a playlist, so
  /// that deleting the playlist later can tell "only ever wanted as part of
  /// this playlist" apart from "also downloaded on its own" — see
  /// [deleteDownloadedPlaylist]. Once true for a track, always true: a
  /// track already downloaded standalone doesn't lose that status just
  /// because it's later swept up into a playlist download too.
  Future<void> download(
    Song song,
    SubsonicClient client, {
    DownloadProgress? onProgress,
    bool standalone = true,
  }) async {
    if (_activeDownloads.containsKey(song.id)) return; // already in progress

    final dir = await _downloadsDir();
    final savePath = p.join(dir, '${song.id}.${song.suffix}');
    final cancelToken = CancelToken();
    _activeDownloads[song.id] = cancelToken;

    try {
      await client.downloadTrack(
        song.id,
        savePath,
        onProgress: (received, total) => onProgress?.call(received, total),
        cancelToken: cancelToken,
      );
      final fileSize = File(savePath).lengthSync();
      final coverPath = await _downloadCoverArt(song, client, cancelToken);
      // Best effort: getLyrics() returns null on any failure, and a song
      // without lyrics is no reason to fail the download.
      final lyrics = await client.getLyrics(song.id);
      await _saveRecord(song, savePath, fileSize, coverPath,
          standalone: standalone, lyrics: lyrics);
    } catch (e) {
      // Clean up partial file
      final f = File(savePath);
      if (f.existsSync()) f.deleteSync();
      rethrow;
    } finally {
      _activeDownloads.remove(song.id);
    }
  }

  Future<void> cancelDownload(String trackId) async {
    _activeDownloads[trackId]?.cancel('User cancelled');
    _activeDownloads.remove(trackId);
  }

  Future<void> deleteDownload(String trackId) async {
    final db = await _database;
    final rows = await db.query('downloads',
        columns: ['local_path', 'cover_local_path'],
        where: 'track_id = ?',
        whereArgs: [trackId]);
    if (rows.isNotEmpty) {
      final path = rows.first['local_path'] as String;
      final f = File(path);
      if (f.existsSync()) f.deleteSync();
      final coverPath = rows.first['cover_local_path'] as String?;
      if (coverPath != null) {
        final cf = File(coverPath);
        if (cf.existsSync()) cf.deleteSync();
      }
    }
    await db.delete('downloads', where: 'track_id = ?', whereArgs: [trackId]);
  }

  // ── Downloaded playlists ─────────────────────────────────────────────────────

  /// Downloads every track in [songs] (same as calling [download] on each,
  /// including their own cover art), then the playlist's own cover art and
  /// description, and records the grouping. If any track fails, this throws
  /// without recording the playlist — tracks that already finished stay
  /// downloaded individually, just not grouped under this playlist; retrying
  /// the whole playlist download will pick up where it left off (`download`
  /// overwrites, it doesn't skip already-downloaded tracks — same cost as
  /// downloading them individually again).
  ///
  /// [onTrackProgress], if given, fires after each track finishes (not
  /// per-byte — track-count granularity is enough for a playlist-level "X of
  /// Y downloaded" indicator, and avoids wiring per-track byte progress
  /// through a whole extra layer for something a progress bar wouldn't show
  /// meaningfully anyway at N tracks).
  Future<void> downloadPlaylist(
    Playlist playlist,
    List<Song> songs,
    SubsonicClient client, {
    void Function(int completed, int total)? onTrackProgress,
  }) async {
    for (var i = 0; i < songs.length; i++) {
      await download(songs[i], client, standalone: false);
      onTrackProgress?.call(i + 1, songs.length);
    }

    final cancelToken = CancelToken();
    final coverPath =
        await _downloadPlaylistCoverArt(playlist, client, cancelToken);

    final db = await _database;
    await db.transaction((txn) async {
      await txn.insert(
        'downloaded_playlists',
        {
          'playlist_id': playlist.id,
          'name': playlist.name,
          'comment': playlist.comment,
          'cover_local_path': coverPath,
          'downloaded_at': DateTime.now().millisecondsSinceEpoch,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      // Re-downloading a playlist (picking up new/changed tracks) should
      // leave it with exactly today's track list, not the union of every
      // download attempt ever made for it.
      await txn.delete('playlist_download_tracks',
          where: 'playlist_id = ?', whereArgs: [playlist.id]);
      for (final song in songs) {
        await txn.insert(
          'playlist_download_tracks',
          {'playlist_id': playlist.id, 'track_id': song.id},
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }

  Future<List<DownloadedPlaylist>> getDownloadedPlaylists() async {
    final db = await _database;
    final rows = await db.rawQuery('''
      SELECT p.*, COUNT(t.track_id) AS track_count
      FROM downloaded_playlists p
      LEFT JOIN playlist_download_tracks t ON t.playlist_id = p.playlist_id
      GROUP BY p.playlist_id
      ORDER BY p.downloaded_at DESC
    ''');
    return rows.map(_rowToPlaylist).toList();
  }

  Future<DownloadedPlaylist?> getDownloadedPlaylist(String playlistId) async {
    final db = await _database;
    final rows = await db.rawQuery('''
      SELECT p.*, COUNT(t.track_id) AS track_count
      FROM downloaded_playlists p
      LEFT JOIN playlist_download_tracks t ON t.playlist_id = p.playlist_id
      WHERE p.playlist_id = ?
      GROUP BY p.playlist_id
    ''', [playlistId]);
    if (rows.isEmpty) return null;
    return _rowToPlaylist(rows.first);
  }

  /// The tracks belonging to a downloaded playlist — same shape as
  /// [getDownloads], just scoped to one playlist's membership instead of
  /// every downloaded track.
  Future<List<DownloadedTrack>> getDownloadedPlaylistTracks(
      String playlistId) async {
    final db = await _database;
    final rows = await db.rawQuery('''
      SELECT d.*
      FROM downloads d
      JOIN playlist_download_tracks t ON t.track_id = d.track_id
      WHERE t.playlist_id = ?
      ORDER BY d.downloaded_at DESC
    ''', [playlistId]);
    return rows.map(_rowToTrack).toList();
  }

  /// Removes the playlist grouping. A member track's file is also deleted,
  /// unless it's still needed — either downloaded standalone (see
  /// [download]'s `standalone` parameter), or a member of another
  /// downloaded playlist too — in which case only its membership in *this*
  /// playlist is dropped, the track itself is left alone.
  Future<void> deleteDownloadedPlaylist(String playlistId) async {
    final db = await _database;
    final rows = await db.query('downloaded_playlists',
        columns: ['cover_local_path'],
        where: 'playlist_id = ?',
        whereArgs: [playlistId]);

    final memberRows = await db.query('playlist_download_tracks',
        columns: ['track_id'],
        where: 'playlist_id = ?',
        whereArgs: [playlistId]);
    final memberIds = memberRows.map((r) => r['track_id'] as String).toList();

    await db.delete('playlist_download_tracks',
        where: 'playlist_id = ?', whereArgs: [playlistId]);
    await db.delete('downloaded_playlists',
        where: 'playlist_id = ?', whereArgs: [playlistId]);

    if (rows.isNotEmpty) {
      final coverPath = rows.first['cover_local_path'] as String?;
      if (coverPath != null) {
        final cf = File(coverPath);
        if (cf.existsSync()) cf.deleteSync();
      }
    }

    for (final trackId in memberIds) {
      await _releaseTrack(db, trackId);
    }
  }

  /// Deletes a track's file once nothing needs it any more: it is neither a
  /// member of another downloaded playlist nor downloaded on its own.
  Future<void> _releaseTrack(Database db, String trackId) async {
    final stillInAnotherPlaylist = Sqflite.firstIntValue(await db.rawQuery(
          'SELECT COUNT(*) FROM playlist_download_tracks WHERE track_id = ?',
          [trackId],
        )) ??
        0;
    if (stillInAnotherPlaylist > 0) return;

    final trackRows = await db.query('downloads',
        columns: ['is_standalone'],
        where: 'track_id = ?',
        whereArgs: [trackId]);
    final isStandalone =
        trackRows.isNotEmpty && (trackRows.first['is_standalone'] as int) == 1;
    if (!isStandalone) {
      await deleteDownload(trackId);
    }
  }

  final Set<String> _syncing = {};

  /// Brings a downloaded playlist up to date with its server copy: tracks
  /// added since are downloaded, tracks removed since are released (their
  /// file is deleted unless something else still needs it), and the stored
  /// name and description follow. Does nothing for a playlist that was never
  /// downloaded. A track that fails to download is left out of the grouping
  /// and retried by the next sync. Returns how many tracks were added or removed.
  ///
  /// [fetch] downloads one track; it defaults to [download] and exists so
  /// tests don't need a network.
  Future<int> syncDownloadedPlaylist(
    Playlist playlist,
    List<Song> songs,
    SubsonicClient client, {
    Future<void> Function(Song song)? fetch,
  }) async {
    final db = await _database;
    final known = await db.query('downloaded_playlists',
        columns: ['playlist_id'],
        where: 'playlist_id = ?',
        whereArgs: [playlist.id]);
    if (known.isEmpty || !_syncing.add(playlist.id)) return 0;
    try {
      final memberRows = await db.query('playlist_download_tracks',
          columns: ['track_id'],
          where: 'playlist_id = ?',
          whereArgs: [playlist.id]);
      final members = memberRows.map((r) => r['track_id'] as String).toSet();
      final wanted = songs.map((s) => s.id).toSet();

      var changed = 0;
      for (final song in songs) {
        if (members.contains(song.id)) continue;
        try {
          if (!await isDownloaded(song.id)) {
            await (fetch ??
                (s) => download(s, client, standalone: false))(song);
          }
        } catch (_) {
          continue;
        }
        await db.insert(
          'playlist_download_tracks',
          {'playlist_id': playlist.id, 'track_id': song.id},
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
        members.add(song.id);
        changed++;
      }

      for (final trackId in members.difference(wanted)) {
        await db.delete('playlist_download_tracks',
            where: 'playlist_id = ? AND track_id = ?',
            whereArgs: [playlist.id, trackId]);
        await _releaseTrack(db, trackId);
        changed++;
      }

      await db.update(
        'downloaded_playlists',
        {'name': playlist.name, 'comment': playlist.comment},
        where: 'playlist_id = ?',
        whereArgs: [playlist.id],
      );
      return changed;
    } finally {
      _syncing.remove(playlist.id);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  Future<String> _downloadsDir() async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory(p.join(base.path, 'downloads'));
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir.path;
  }

  Future<String> _coversDir() async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory(p.join(base.path, 'downloads', 'covers'));
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir.path;
  }

  /// Best-effort — a failed or missing cover shouldn't fail the track
  /// download itself, so any error *other* than the download being
  /// cancelled is swallowed here rather than propagated to [download]'s
  /// `catch`. A genuine cancellation is rethrown so that handler still
  /// cleans up the partial track file and reports the cancellation, instead
  /// of this silently completing the download as "successful, no cover".
  Future<String?> _downloadCoverArt(
    Song song,
    SubsonicClient client,
    CancelToken cancelToken,
  ) async {
    if (song.coverArt == null) return null;
    try {
      final dir = await _coversDir();
      final path = p.join(dir, '${song.id}.jpg');
      await client.downloadCoverArt(song.coverArt!, path,
          size: 600, cancelToken: cancelToken);
      return path;
    } catch (e) {
      if (cancelToken.isCancelled) rethrow;
      return null;
    }
  }

  /// Same best-effort/cancellation handling as [_downloadCoverArt], for a
  /// playlist's own cover instead of a track's.
  Future<String?> _downloadPlaylistCoverArt(
    Playlist playlist,
    SubsonicClient client,
    CancelToken cancelToken,
  ) async {
    if (playlist.coverArt == null) return null;
    try {
      final dir = await _coversDir();
      final path = p.join(dir, 'playlist_${playlist.id}.jpg');
      await client.downloadCoverArt(playlist.coverArt!, path,
          size: 600, cancelToken: cancelToken);
      return path;
    } catch (e) {
      if (cancelToken.isCancelled) rethrow;
      return null;
    }
  }

  Future<void> _saveRecord(
    Song song,
    String path,
    int fileSize,
    String? coverPath, {
    required bool standalone,
    Lyrics? lyrics,
  }) async {
    final db = await _database;
    final existing = await db.query('downloads',
        columns: ['is_standalone'],
        where: 'track_id = ?',
        whereArgs: [song.id]);
    final wasStandalone =
        existing.isNotEmpty && (existing.first['is_standalone'] as int) == 1;

    await db.insert(
      'downloads',
      {
        'track_id': song.id,
        'local_path': path,
        'title': song.title,
        'artist': song.artist,
        'album': song.album,
        'cover_art_id': song.coverArt,
        'cover_local_path': coverPath,
        'file_size': fileSize,
        'downloaded_at': DateTime.now().millisecondsSinceEpoch,
        'is_standalone': (standalone || wasStandalone) ? 1 : 0,
        'lyrics_json': lyrics == null ? null : jsonEncode(lyrics.toJson()),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  DownloadedTrack _rowToTrack(Map<String, dynamic> row) => DownloadedTrack(
        trackId: row['track_id'] as String,
        localPath: row['local_path'] as String,
        title: row['title'] as String,
        artist: row['artist'] as String,
        album: row['album'] as String,
        coverArtId: row['cover_art_id'] as String?,
        coverLocalPath: row['cover_local_path'] as String?,
        fileSize: row['file_size'] as int?,
        downloadedAt:
            DateTime.fromMillisecondsSinceEpoch(row['downloaded_at'] as int),
      );

  DownloadedPlaylist _rowToPlaylist(Map<String, dynamic> row) =>
      DownloadedPlaylist(
        playlistId: row['playlist_id'] as String,
        name: row['name'] as String,
        comment: row['comment'] as String?,
        coverLocalPath: row['cover_local_path'] as String?,
        downloadedAt:
            DateTime.fromMillisecondsSinceEpoch(row['downloaded_at'] as int),
        trackCount: row['track_count'] as int,
      );
}
