import '../utils/credits.dart';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'types.dart';

class SubsonicClient {
  final Credentials credentials;
  final Dio _dio;

  // Salted token computed once per client (i.e. once per login session) and
  // reused for every request — NOT regenerated per call. Media URLs built
  // from these params (coverArtUrl, streamUrl) get embedded as `<img src>`/
  // cache keys; a fresh salt on every call made every "identical" cover art
  // request look like a different URL, defeating CachedNetworkImage's cache
  // entirely and re-fetching + re-decoding the same image nonstop (visible
  // as dozens of duplicate getCoverArt requests per second in server logs).
  late final String _salt = _randomSalt();
  late final String _token = _computeToken(credentials.password, _salt);

  SubsonicClient(this.credentials, {Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 30),
            ));

  // ── Auth helpers ────────────────────────────────────────────────────────────

  static String _randomSalt() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final rng = Random.secure();
    return List.generate(8, (_) => chars[rng.nextInt(chars.length)]).join();
  }

  static String _computeToken(String password, String salt) {
    final bytes = utf8.encode('$password$salt');
    return md5.convert(bytes).toString();
  }

  Map<String, String> _authParams() {
    return {
      'u': credentials.username,
      't': _token,
      's': _salt,
      'v': '1.16.1',
      'c': 'riffplayer-flutter',
      'f': 'json',
    };
  }

  String _url(String endpoint) => '${credentials.serverUrl}/rest/$endpoint';

  // ── Media URL builders (used as audio/image src) ────────────────────────────

  String streamUrl(String trackId) {
    final params = {..._authParams(), 'id': trackId};
    final query = params.entries
        .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}')
        .join('&');
    return '${_url('stream.view')}?$query';
  }

  String coverArtUrl(String id, {int? size}) {
    final params = {..._authParams(), 'id': id};
    if (size != null) params['size'] = size.toString();
    final query = params.entries
        .map((e) => '${e.key}=${Uri.encodeComponent(e.value)}')
        .join('&');
    return '${_url('getCoverArt.view')}?$query';
  }

  // ── Core GET wrapper ────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> _get(
    String endpoint, [
    Map<String, String> extra = const {},
  ]) async {
    final params = {..._authParams(), ...extra};
    final response = await _dio.get<Map<String, dynamic>>(
      _url(endpoint),
      queryParameters: params,
    );
    final body = response.data!;
    final sr = body['subsonic-response'] as Map<String, dynamic>;
    if (sr['status'] != 'ok') {
      final err = sr['error'] as Map<String, dynamic>?;
      throw Exception(err?['message'] ?? 'Subsonic error');
    }
    return sr;
  }

  // ── Custom API login (returns JWT, null if unavailable) ─────────────────────

  Future<String?> loginCustomApi(String username, String password) async {
    try {
      final r = await _dio.post<Map<String, dynamic>>(
        '${credentials.serverUrl}/api/v1/auth/login',
        data: {'username': username, 'password': password},
      );
      return r.data?['token'] as String?;
    } catch (_) {
      return null;
    }
  }

  // ── Ping ────────────────────────────────────────────────────────────────────

  Future<void> ping() => _get('ping.view');

  // ── Browse ──────────────────────────────────────────────────────────────────

  Future<List<ArtistIndex>> getArtists() async {
    final r = await _get('getArtists.view');
    final indexes = r['artists']['index'] as List<dynamic>? ?? [];
    return indexes
        .map((i) => ArtistIndex.fromJson(i as Map<String, dynamic>))
        .toList();
  }

  Future<Artist> getArtist(String id) async {
    final r = await _get('getArtist.view', {'id': id});
    final a = r['artist'] as Map<String, dynamic>;
    final albums = (a['album'] as List<dynamic>? ?? [])
        .map((al) => Album.fromJson(al as Map<String, dynamic>))
        .toList();
    return Artist.fromJson({...a, 'albumCount': albums.length});
  }

  Future<({Artist artist, List<Album> albums})> getArtistDetail(
      String id) async {
    final r = await _get('getArtist.view', {'id': id});
    final a = r['artist'] as Map<String, dynamic>;
    final albums = (a['album'] as List<dynamic>? ?? [])
        .map((al) => Album.fromJson(al as Map<String, dynamic>))
        .toList();
    return (artist: Artist.fromJson(a), albums: albums);
  }

  /// [quality] ('lossless' | 'hires') is a RiffPlayer extension that keeps only
  /// albums with at least one such track; stock servers ignore it.
  Future<List<Album>> getAlbumList(String type,
      {int size = 50, int offset = 0, String? quality}) async {
    final r = await _get('getAlbumList2.view', {
      'type': type,
      'size': size.toString(),
      'offset': offset.toString(),
      if (quality != null) 'quality': quality,
    });
    final list = (r['albumList2']?['album'] as List<dynamic>?) ?? [];
    return list.map((a) => Album.fromJson(a as Map<String, dynamic>)).toList();
  }

  Future<({Album album, List<Song> songs})> getAlbum(String id) async {
    final r = await _get('getAlbum.view', {'id': id});
    final a = r['album'] as Map<String, dynamic>;
    final songs = (a['song'] as List<dynamic>? ?? [])
        .map((s) => Song.fromJson(s as Map<String, dynamic>))
        .toList();
    return (album: Album.fromJson(a), songs: songs);
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  Future<SearchResult> search(String query) async {
    final r = await _get('search3.view', {
      'query': query,
      'artistCount': '10',
      'albumCount': '20',
      'songCount': '30',
    });
    final sr3 = r['searchResult3'] as Map<String, dynamic>? ?? {};
    return SearchResult(
      artists: (sr3['artist'] as List<dynamic>? ?? [])
          .map((a) => Artist.fromJson(a as Map<String, dynamic>))
          .toList(),
      albums: (sr3['album'] as List<dynamic>? ?? [])
          .map((a) => Album.fromJson(a as Map<String, dynamic>))
          .toList(),
      songs: (sr3['song'] as List<dynamic>? ?? [])
          .map((s) => Song.fromJson(s as Map<String, dynamic>))
          .toList(),
    );
  }

  /// A flat, paginated view of every song in the library — a wildcard
  /// search3 query, matching the web client's approach (no dedicated
  /// server endpoint exists for this).
  ///
  /// [genre] and [sort] ('title' | 'added_desc' | 'added_asc') are RiffPlayer
  /// extensions to search3; stock Subsonic servers ignore them.
  Future<List<Song>> getAllSongs(int offset, int limit,
      {String? genre, String sort = 'title', String? quality}) async {
    final r = await _get('search3.view', {
      'query': '',
      'artistCount': '0',
      'albumCount': '0',
      'songCount': '$limit',
      'songOffset': '$offset',
      if (genre != null) 'genre': genre,
      if (quality != null) 'quality': quality,
      'sort': sort,
    });
    final sr3 = r['searchResult3'] as Map<String, dynamic>? ?? {};
    return (sr3['song'] as List<dynamic>? ?? [])
        .map((s) => Song.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  /// Every genre tag in the library with its song count (tracks with no
  /// genre aren't listed).
  Future<List<({String name, int songCount})>> getGenres() async {
    final r = await _get('getGenres.view', {});
    final list =
        (r['genres'] as Map<String, dynamic>?)?['genre'] as List<dynamic>?;
    return [
      for (final g in list ?? const [])
        (
          name: (g as Map<String, dynamic>)['value'] as String,
          songCount: (g['songCount'] as num?)?.toInt() ?? 0,
        ),
    ];
  }

  /// Synced (or plain-text) lyrics for a track, or null if none are
  /// available anywhere (DB cache, .lrc sidecar, LRCLIB).
  Future<Lyrics?> getLyrics(String songId) async {
    try {
      final r = await _get('getLyricsBySongId.view', {'id': songId});
      final list = (r['lyricsList']
          as Map<String, dynamic>?)?['structuredLyrics'] as List<dynamic>?;
      if (list == null || list.isEmpty) return null;
      return Lyrics.fromJson(list.first as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  // ── Favourites ──────────────────────────────────────────────────────────────

  Future<({List<Artist> artists, List<Album> albums, List<Song> songs})>
      getStarred() async {
    final r = await _get('getStarred2.view');
    final s2 = r['starred2'] as Map<String, dynamic>? ?? {};
    return (
      artists: (s2['artist'] as List<dynamic>? ?? [])
          .map((a) => Artist.fromJson(a as Map<String, dynamic>))
          .toList(),
      albums: (s2['album'] as List<dynamic>? ?? [])
          .map((a) => Album.fromJson(a as Map<String, dynamic>))
          .toList(),
      songs: (s2['song'] as List<dynamic>? ?? [])
          .map((s) => Song.fromJson(s as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<void> star({String? id, String? albumId, String? artistId}) =>
      _get('star.view', {
        if (id != null) 'id': id,
        if (albumId != null) 'albumId': albumId,
        if (artistId != null) 'artistId': artistId,
      });

  Future<void> unstar({String? id, String? albumId, String? artistId}) =>
      _get('unstar.view', {
        if (id != null) 'id': id,
        if (albumId != null) 'albumId': albumId,
        if (artistId != null) 'artistId': artistId,
      });

  // ── Playlists ───────────────────────────────────────────────────────────────

  Future<List<Playlist>> getPlaylists() async {
    final r = await _get('getPlaylists.view');
    final list = (r['playlists']?['playlist'] as List<dynamic>?) ?? [];
    return list
        .map((p) => Playlist.fromJson(p as Map<String, dynamic>))
        .toList();
  }

  Future<Playlist> getPlaylist(String id) async {
    final r = await _get('getPlaylist.view', {'id': id});
    return Playlist.fromJson(r['playlist'] as Map<String, dynamic>);
  }

  Future<Playlist> createPlaylist(String name) async {
    final r = await _get('createPlaylist.view', {'name': name});
    return Playlist.fromJson(r['playlist'] as Map<String, dynamic>);
  }

  Future<void> deletePlaylist(String id) =>
      _get('deletePlaylist.view', {'id': id});

  Future<void> renamePlaylist(String playlistId, String name) =>
      _get('updatePlaylist.view', {'playlistId': playlistId, 'name': name});

  Future<void> setPlaylistDescription(String playlistId, String comment) =>
      _get('updatePlaylist.view',
          {'playlistId': playlistId, 'comment': comment});

  // ── Saved play queue (resume where you left off) ────────────────────────────

  /// Stores the queue on the server (one per user) so any device can pick it up later. The ids go in a
  /// JSON body: a queue of hundreds of songs would not fit in a URL.
  Future<void> savePlayQueue(
    List<String> ids, {
    String? current,
    int positionMs = 0,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      _url('savePlayQueue.view'),
      queryParameters: _authParams(),
      data: {
        'id': ids,
        if (current != null) 'current': current,
        'position': positionMs.toString(),
      },
    );
    final sr = response.data?['subsonic-response'] as Map<String, dynamic>?;
    if (sr == null || sr['status'] != 'ok') {
      final err = sr?['error'] as Map<String, dynamic>?;
      throw Exception(err?['message'] ?? 'Subsonic error');
    }
  }

  /// The saved queue, or null when there is none (or it is empty).
  Future<SavedPlayQueue?> getPlayQueue() async {
    final r = await _get('getPlayQueue.view');
    final q = r['playQueue'] as Map<String, dynamic>?;
    final entries = q?['entry'] as List<dynamic>? ?? [];
    if (q == null || entries.isEmpty) return null;
    return SavedPlayQueue(
      songs:
          entries.map((s) => Song.fromJson(s as Map<String, dynamic>)).toList(),
      current: q['current'] as String?,
      positionMs: (q['position'] as num?)?.toInt() ?? 0,
      changed: DateTime.tryParse(q['changed'] as String? ?? ''),
    );
  }

  Future<void> addSongToPlaylist(String playlistId, String songId) => _get(
        'updatePlaylist.view',
        {'playlistId': playlistId, 'songIdToAdd': songId},
      );

  // ── Custom /api/v1 endpoints (Subsonic auth doesn't cover these) ────────────

  Future<Map<String, dynamic>> _apiCall(
    String method,
    String path, {
    Object? data,
  }) async {
    final headers = <String, String>{
      if (credentials.token != null)
        'Authorization': 'Bearer ${credentials.token}',
    };
    final response = await _dio.request<Map<String, dynamic>>(
      '${credentials.serverUrl}/api/v1/$path',
      data: data,
      options: Options(method: method, headers: headers),
    );
    return response.data ?? {};
  }

  Future<void> reorderPlaylistTracks(
          String playlistId, List<String> trackIds) =>
      _apiCall('PUT', 'playlists/$playlistId/tracks',
          data: {'trackIds': trackIds});

  /// When each track was added to this playlist, keyed by track id.
  Future<Map<String, DateTime>> getPlaylistTrackDates(String playlistId) async {
    final r = await _apiCall('GET', 'playlists/$playlistId/track-dates');
    final dates = r['dates'] as Map<String, dynamic>? ?? {};
    return dates.map((k, v) => MapEntry(k, DateTime.parse(v as String)));
  }

  Future<void> uploadPlaylistCover(String playlistId, String filePath) async {
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(filePath),
    });
    await _apiCall('POST', 'playlists/$playlistId/cover', data: form);
  }

  // ── Listening history (Home page) ────────────────────────────────────────────

  Future<List<Song>> getMostPlayed() async {
    final r = await _apiCall('GET', 'history/most-played');
    return (r['songs'] as List<dynamic>? ?? [])
        .map((s) => Song.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  /// The single most recently played track, or null with no play history yet.
  Future<Song?> getLastPlayed() async {
    final r = await _apiCall('GET', 'history/last-played');
    final song = r['song'] as Map<String, dynamic>?;
    return song != null ? Song.fromJson(song) : null;
  }

  /// Tracks never played (or played longest ago) among ones old enough to count.
  Future<List<Song>> getRediscover() async {
    final r = await _apiCall('GET', 'history/rediscover');
    return (r['songs'] as List<dynamic>? ?? [])
        .map((s) => Song.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  /// Most recently played tracks, newest first.
  Future<List<Song>> getRecentlyPlayed() async {
    final r = await _apiCall('GET', 'history/recent');
    return (r['songs'] as List<dynamic>? ?? [])
        .map((s) => Song.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  // ── Library sidebar (pin + recency state for the unified Library list) ───────

  Future<List<LibrarySidebarItem>> getLibrarySidebarState() async {
    final r = await _apiCall('GET', 'library-sidebar');
    return (r['items'] as List<dynamic>? ?? [])
        .map((i) => LibrarySidebarItem.fromJson(i as Map<String, dynamic>))
        .toList();
  }

  Future<void> recordLibraryInteraction(String itemType, String itemKey) =>
      _apiCall('POST', 'library-sidebar/interact',
          data: {'itemType': itemType, 'itemKey': itemKey});

  Future<void> pinLibraryItem(String itemType, String itemKey) =>
      _apiCall('POST', 'library-sidebar/pin',
          data: {'itemType': itemType, 'itemKey': itemKey});

  Future<void> unpinLibraryItem(String itemType, String itemKey) =>
      _apiCall('POST', 'library-sidebar/unpin',
          data: {'itemType': itemType, 'itemKey': itemKey});

  // ── Recommendations & Wrapped ─────────────────────────────────────────────────

  Future<RecommendationsResult> getRecommendations(String type) async {
    final r = await _apiCall('GET', 'recommendations/$type');
    final songs = (r['songs'] as List<dynamic>? ?? [])
        .map((s) => Song.fromJson(s as Map<String, dynamic>))
        .toList();
    return RecommendationsResult(songs: songs, source: r['source'] as String?);
  }

  Future<WrappedStats> getWrapped({int? year}) async {
    final path = year != null
        ? 'recommendations/wrapped?year=$year'
        : 'recommendations/wrapped';
    final r = await _apiCall('GET', path);
    return WrappedStats.fromJson(r);
  }

  Future<String> generateWrappedSummary({int? year}) async {
    final path = year != null
        ? 'recommendations/wrapped/summary?year=$year'
        : 'recommendations/wrapped/summary';
    final r = await _apiCall('POST', path);
    return r['summary'] as String? ?? '';
  }

  /// Credits read from a track's own tags, as ordered (label, value) rows —
  /// only what the file says. Empty when there is nothing to show.
  Future<List<(String, String)>> getTrackCredits(String id) async {
    final r =
        await _apiCall('GET', 'tracks/${Uri.encodeComponent(id)}/credits');
    return creditRows((r['credits'] as Map<String, dynamic>?) ?? const {});
  }

  // ── User preferences ──────────────────────────────────────────────────────────

  Future<MeInfo> getMe() async {
    final r = await _apiCall('GET', 'users/me');
    return MeInfo.fromJson(r);
  }

  Future<void> updateMyPreferences(Map<String, dynamic> prefs) =>
      _apiCall('PATCH', 'users/me/preferences', data: prefs);

  /// Throws a [DioException] with the server's message (e.g. "Current
  /// password is incorrect") in `e.response?.data['error']` on failure.
  Future<void> changeMyPassword(String currentPassword, String newPassword) =>
      _apiCall('PATCH', 'users/me/password', data: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      });

  /// Admin-only. Permanently deletes the track's file from disk along with
  /// its library entry.
  Future<void> deleteTrack(String songId) =>
      _apiCall('DELETE', 'admin/tracks/$songId');

  // ── Admin: users ────────────────────────────────────────────────────────────

  Future<List<AdminUser>> adminGetUsers() async {
    final r = await _apiCall('GET', 'admin/users');
    return (r['users'] as List<dynamic>? ?? [])
        .map((u) => AdminUser.fromJson(u as Map<String, dynamic>))
        .toList();
  }

  Future<void> adminCreateUser(String username, String password, String role) =>
      _apiCall('POST', 'admin/users',
          data: {'username': username, 'password': password, 'role': role});

  Future<void> adminUpdateUser(int id, {String? password, String? role}) =>
      _apiCall('PATCH', 'admin/users/$id', data: {
        if (password != null) 'password': password,
        if (role != null) 'role': role,
      });

  Future<void> adminDeleteUser(int id) => _apiCall('DELETE', 'admin/users/$id');

  // ── Admin: libraries ────────────────────────────────────────────────────────

  Future<List<Library>> adminGetLibraries() async {
    final r = await _apiCall('GET', 'admin/libraries');
    return (r['libraries'] as List<dynamic>? ?? [])
        .map((l) => Library.fromJson(l as Map<String, dynamic>))
        .toList();
  }

  Future<void> adminAddLibrary(String name, String path) =>
      _apiCall('POST', 'admin/libraries', data: {'name': name, 'path': path});

  Future<void> adminDeleteLibrary(int id) =>
      _apiCall('DELETE', 'admin/libraries/$id');

  Future<void> adminScanLibrary(int id) =>
      _apiCall('POST', 'admin/libraries/$id/scan');

  // ── Admin: server settings ─────────────────────────────────────────────────

  Future<Map<String, String>> adminGetSettings() async {
    final r = await _apiCall('GET', 'admin/settings');
    return Map<String, String>.from(r['settings'] as Map? ?? {});
  }

  Future<void> adminPatchSettings(Map<String, String?> patch) =>
      _apiCall('PATCH', 'admin/settings', data: patch);

  // ── Scrobble ─────────────────────────────────────────────────────────────────

  Future<void> scrobble(String id, {bool submission = true}) =>
      _get('scrobble.view', {
        'id': id,
        'submission': submission.toString(),
      });

  // ── Download (with progress) ─────────────────────────────────────────────────

  Future<void> downloadTrack(
    String trackId,
    String savePath, {
    ProgressCallback? onProgress,
    CancelToken? cancelToken,
  }) async {
    final params = {..._authParams(), 'id': trackId};
    await _dio.download(
      _url('download.view'),
      savePath,
      queryParameters: params,
      onReceiveProgress: onProgress,
      cancelToken: cancelToken,
    );
  }

  /// Saves a track's cover art to disk — used by [DownloadService] so a
  /// downloaded track's artwork is available offline too, instead of every
  /// display of it needing a live [coverArtUrl] fetch.
  Future<void> downloadCoverArt(
    String coverArtId,
    String savePath, {
    int? size,
    CancelToken? cancelToken,
  }) async {
    final params = {..._authParams(), 'id': coverArtId};
    if (size != null) params['size'] = size.toString();
    await _dio.download(
      _url('getCoverArt.view'),
      savePath,
      queryParameters: params,
      cancelToken: cancelToken,
    );
  }
}

/// A queue saved on the server by whichever device was playing last.
class SavedPlayQueue {
  final List<Song> songs;
  final String? current;
  final int positionMs;

  /// When it was last saved (UTC), if the server said.
  final DateTime? changed;

  const SavedPlayQueue({
    required this.songs,
    required this.current,
    required this.positionMs,
    required this.changed,
  });
}
