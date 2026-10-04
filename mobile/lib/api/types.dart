class Credentials {
  final String serverUrl;
  final String username;
  final String password;
  final String? token; // JWT for /api/v1

  const Credentials({
    required this.serverUrl,
    required this.username,
    required this.password,
    this.token,
  });

  Credentials copyWith({String? token}) => Credentials(
        serverUrl: serverUrl,
        username: username,
        password: password,
        token: token ?? this.token,
      );
}

class Artist {
  final String id;
  final String name;
  final int albumCount;
  final String? coverArt;
  final String? starred;

  const Artist({
    required this.id,
    required this.name,
    required this.albumCount,
    this.coverArt,
    this.starred,
  });

  factory Artist.fromJson(Map<String, dynamic> j) => Artist(
        id: j['id'] as String,
        name: j['name'] as String,
        albumCount: (j['albumCount'] as num?)?.toInt() ?? 0,
        coverArt: j['coverArt'] as String?,
        starred: j['starred'] as String?,
      );

  bool get isStarred => starred != null;
}

class ArtistIndex {
  final String name;
  final List<Artist> artists;

  const ArtistIndex({required this.name, required this.artists});

  factory ArtistIndex.fromJson(Map<String, dynamic> j) => ArtistIndex(
        name: j['name'] as String,
        artists: (j['artist'] as List<dynamic>? ?? [])
            .map((a) => Artist.fromJson(a as Map<String, dynamic>))
            .toList(),
      );
}

class Album {
  final String id;
  final String name;
  final String artist;
  final String artistId;
  final int? year;
  final String? coverArt;
  final int songCount;
  final int duration;
  final String? starred;

  const Album({
    required this.id,
    required this.name,
    required this.artist,
    required this.artistId,
    this.year,
    this.coverArt,
    required this.songCount,
    required this.duration,
    this.starred,
  });

  factory Album.fromJson(Map<String, dynamic> j) => Album(
        id: j['id'] as String,
        name: j['name'] as String,
        artist: j['artist'] as String? ?? '',
        artistId: j['artistId'] as String? ?? '',
        year: (j['year'] as num?)?.toInt(),
        coverArt: j['coverArt'] as String?,
        songCount: (j['songCount'] as num?)?.toInt() ?? 0,
        duration: (j['duration'] as num?)?.toInt() ?? 0,
        starred: j['starred'] as String?,
      );

  bool get isStarred => starred != null;
}

class Song {
  final String id;
  final String title;
  final String artist;
  final String artistId;
  final String album;
  final String albumId;
  final int? track;
  final int? discNumber;
  final int? year;
  final int? duration; // seconds
  final int? size;
  final String? coverArt;
  final String suffix;
  final String? starred;
  final double? replayGainTrackGain;
  final double? replayGainAlbumGain;

  /// When this track was indexed into the library — the Subsonic `created`
  /// field. Shown as a "date added" column wherever the surrounding screen
  /// (All Songs, playlists) chooses to pass it through.
  final DateTime? created;
  final int? bitRate;
  final int? playCount;

  /// Audio format details (OpenSubsonic names). Null until the server has
  /// scanned the file with a version that records them.
  final int? samplingRate;
  final int? bitDepth;
  final int? channelCount;
  final String? codec;
  final bool? lossless;

  const Song({
    required this.id,
    required this.title,
    required this.artist,
    required this.artistId,
    required this.album,
    required this.albumId,
    this.track,
    this.discNumber,
    this.year,
    this.duration,
    this.size,
    this.coverArt,
    required this.suffix,
    this.starred,
    this.replayGainTrackGain,
    this.replayGainAlbumGain,
    this.created,
    this.bitRate,
    this.playCount,
    this.samplingRate,
    this.bitDepth,
    this.channelCount,
    this.codec,
    this.lossless,
  });

  factory Song.fromJson(Map<String, dynamic> j) => Song(
        id: j['id'] as String,
        title: j['title'] as String,
        artist: j['artist'] as String? ?? '',
        artistId: j['artistId'] as String? ?? '',
        album: j['album'] as String? ?? '',
        albumId: j['albumId'] as String? ?? '',
        track: (j['track'] as num?)?.toInt(),
        discNumber: (j['discNumber'] as num?)?.toInt(),
        year: (j['year'] as num?)?.toInt(),
        duration: (j['duration'] as num?)?.toInt(),
        size: (j['size'] as num?)?.toInt(),
        coverArt: j['coverArt'] as String?,
        suffix: j['suffix'] as String? ?? 'mp3',
        starred: j['starred'] as String?,
        replayGainTrackGain: (j['replayGainTrackGain'] as num?)?.toDouble(),
        replayGainAlbumGain: (j['replayGainAlbumGain'] as num?)?.toDouble(),
        created: j['created'] != null
            ? DateTime.tryParse(j['created'] as String)
            : null,
        bitRate: (j['bitRate'] as num?)?.toInt(),
        playCount: (j['playCount'] as num?)?.toInt(),
        samplingRate: (j['samplingRate'] as num?)?.toInt(),
        bitDepth: (j['bitDepth'] as num?)?.toInt(),
        channelCount: (j['channelCount'] as num?)?.toInt(),
        codec: j['codec'] as String?,
        lossless: j['lossless'] as bool?,
      );

  bool get isStarred => starred != null;

  Song withStarred(String? starred) => Song(
        id: id,
        title: title,
        artist: artist,
        artistId: artistId,
        album: album,
        albumId: albumId,
        track: track,
        discNumber: discNumber,
        year: year,
        duration: duration,
        size: size,
        coverArt: coverArt,
        suffix: suffix,
        starred: starred,
        replayGainTrackGain: replayGainTrackGain,
        replayGainAlbumGain: replayGainAlbumGain,
        created: created,
        bitRate: bitRate,
        playCount: playCount,
        samplingRate: samplingRate,
        bitDepth: bitDepth,
        channelCount: channelCount,
        codec: codec,
        lossless: lossless,
      );
}

class Playlist {
  final String id;
  final String name;
  final String owner;
  final int songCount;
  final int duration;
  final String? coverArt;

  /// Playlist description — "comment" is the Subsonic API's field name for it.
  final String? comment;
  final List<Song>? entries;

  const Playlist({
    required this.id,
    required this.name,
    required this.owner,
    required this.songCount,
    required this.duration,
    this.coverArt,
    this.comment,
    this.entries,
  });

  factory Playlist.fromJson(Map<String, dynamic> j) => Playlist(
        id: j['id'] as String,
        name: j['name'] as String,
        owner: j['owner'] as String? ?? '',
        songCount: (j['songCount'] as num?)?.toInt() ?? 0,
        duration: (j['duration'] as num?)?.toInt() ?? 0,
        coverArt: j['coverArt'] as String?,
        comment: j['comment'] as String?,
        entries: (j['entry'] as List<dynamic>?)
            ?.map((s) => Song.fromJson(s as Map<String, dynamic>))
            .toList(),
      );
}

class SearchResult {
  final List<Artist> artists;
  final List<Album> albums;
  final List<Song> songs;

  const SearchResult({
    required this.artists,
    required this.albums,
    required this.songs,
  });
}

class DownloadedTrack {
  final String trackId;
  final String localPath;
  final String title;
  final String artist;
  final String album;
  final String? coverArtId;

  /// Where this track's cover art was saved on disk, if it had one and the
  /// fetch succeeded — cover art is best-effort, so this can be null even
  /// when [coverArtId] isn't.
  final String? coverLocalPath;
  final int? fileSize;
  final DateTime downloadedAt;

  const DownloadedTrack({
    required this.trackId,
    required this.localPath,
    required this.title,
    required this.artist,
    required this.album,
    this.coverArtId,
    this.coverLocalPath,
    this.fileSize,
    required this.downloadedAt,
  });
}

/// A playlist downloaded as a unit (via [DownloadService.downloadPlaylist])
/// — distinct from [DownloadedTrack]: this is the grouping, not a track.
/// [trackCount] reflects how many tracks were part of the playlist at
/// download time (`playlist_download_tracks` membership), not how many of
/// those tracks' files still exist on disk right now.
class DownloadedPlaylist {
  final String playlistId;
  final String name;
  final String? comment;
  final String? coverLocalPath;
  final DateTime downloadedAt;
  final int trackCount;

  const DownloadedPlaylist({
    required this.playlistId,
    required this.name,
    this.comment,
    this.coverLocalPath,
    required this.downloadedAt,
    required this.trackCount,
  });
}

class WrappedTopTrack {
  final String id;
  final String title;
  final String artist;
  final String artistId;
  final String album;
  final String albumId;
  final String? coverArt;
  final int playCount;

  const WrappedTopTrack({
    required this.id,
    required this.title,
    required this.artist,
    required this.artistId,
    required this.album,
    required this.albumId,
    this.coverArt,
    required this.playCount,
  });

  factory WrappedTopTrack.fromJson(Map<String, dynamic> j) => WrappedTopTrack(
        id: j['id'] as String,
        title: j['title'] as String,
        artist: j['artist'] as String? ?? '',
        artistId: j['artistId'] as String? ?? '',
        album: j['album'] as String? ?? '',
        albumId: j['albumId'] as String? ?? '',
        coverArt: j['coverArt'] as String?,
        playCount: (j['playCount'] as num?)?.toInt() ?? 0,
      );
}

class WrappedTopArtist {
  final String id;
  final String name;
  final String? coverArt;
  final int playCount;

  const WrappedTopArtist({
    required this.id,
    required this.name,
    this.coverArt,
    required this.playCount,
  });

  factory WrappedTopArtist.fromJson(Map<String, dynamic> j) => WrappedTopArtist(
        id: j['id'] as String,
        name: j['name'] as String,
        coverArt: j['coverArt'] as String?,
        playCount: (j['playCount'] as num?)?.toInt() ?? 0,
      );
}

class WrappedMonth {
  final int month;
  final int plays;

  const WrappedMonth({required this.month, required this.plays});

  factory WrappedMonth.fromJson(Map<String, dynamic> j) => WrappedMonth(
        month: (j['month'] as num).toInt(),
        plays: (j['plays'] as num).toInt(),
      );
}

class WrappedStats {
  final int year;
  final int totalPlays;
  final int totalMinutes;
  final List<WrappedTopTrack> topTracks;
  final List<WrappedTopArtist> topArtists;
  final List<WrappedMonth> byMonth;

  const WrappedStats({
    required this.year,
    required this.totalPlays,
    required this.totalMinutes,
    required this.topTracks,
    required this.topArtists,
    required this.byMonth,
  });

  factory WrappedStats.fromJson(Map<String, dynamic> j) => WrappedStats(
        year: (j['year'] as num).toInt(),
        totalPlays: (j['totalPlays'] as num?)?.toInt() ?? 0,
        totalMinutes: (j['totalMinutes'] as num?)?.toInt() ?? 0,
        topTracks: (j['topTracks'] as List<dynamic>? ?? [])
            .map((t) => WrappedTopTrack.fromJson(t as Map<String, dynamic>))
            .toList(),
        topArtists: (j['topArtists'] as List<dynamic>? ?? [])
            .map((a) => WrappedTopArtist.fromJson(a as Map<String, dynamic>))
            .toList(),
        byMonth: (j['byMonth'] as List<dynamic>? ?? [])
            .map((m) => WrappedMonth.fromJson(m as Map<String, dynamic>))
            .toList(),
      );
}

/// One weekly-discovery suggestion: names only, never a link or a source.
class DiscoveryItem {
  const DiscoveryItem(
      {required this.artist, this.track, this.because = const []});
  final String artist;
  final String? track;
  final List<String> because;

  factory DiscoveryItem.fromJson(Map<String, dynamic> j) => DiscoveryItem(
        artist: j['artist'] as String? ?? '',
        track: j['track'] as String?,
        because: [
          for (final b in (j['because'] as List<dynamic>? ?? const []))
            b as String
        ],
      );
}

enum WeeklyStatus { ok, notConfigured, noHistory }

class WeeklyDiscovery {
  const WeeklyDiscovery(this.status, {this.week, this.items = const []});
  final WeeklyStatus status;

  /// Monday of the week (YYYY-MM-DD).
  final String? week;
  final List<DiscoveryItem> items;

  factory WeeklyDiscovery.fromJson(Map<String, dynamic> j) {
    final status = switch (j['status']) {
      'not_configured' => WeeklyStatus.notConfigured,
      'no_history' => WeeklyStatus.noHistory,
      _ => WeeklyStatus.ok,
    };
    return WeeklyDiscovery(
      status,
      week: j['week'] as String?,
      items: [
        for (final i in (j['items'] as List<dynamic>? ?? const []))
          DiscoveryItem.fromJson(i as Map<String, dynamic>)
      ],
    );
  }
}

class RecommendationsResult {
  final List<Song> songs;
  final String? source;

  const RecommendationsResult({required this.songs, this.source});
}

class UserPreferences {
  final String? transcodeFormat;
  final int? transcodeBitrate;
  final String? lastfmSessionKey;
  final String? listenbrainzToken;

  const UserPreferences({
    this.transcodeFormat,
    this.transcodeBitrate,
    this.lastfmSessionKey,
    this.listenbrainzToken,
  });

  factory UserPreferences.fromJson(Map<String, dynamic> j) => UserPreferences(
        transcodeFormat: j['transcode_format'] as String?,
        transcodeBitrate: (j['transcode_bitrate'] as num?)?.toInt(),
        lastfmSessionKey: j['lastfm_session_key'] as String?,
        listenbrainzToken: j['listenbrainz_token'] as String?,
      );
}

class MeInfo {
  final int id;
  final String username;
  final String role;
  final UserPreferences? preferences;

  const MeInfo({
    required this.id,
    required this.username,
    required this.role,
    this.preferences,
  });

  factory MeInfo.fromJson(Map<String, dynamic> j) => MeInfo(
        id: (j['id'] as num).toInt(),
        username: j['username'] as String,
        role: j['role'] as String,
        preferences: j['preferences'] != null
            ? UserPreferences.fromJson(j['preferences'] as Map<String, dynamic>)
            : null,
      );

  bool get isAdmin => role == 'admin';
}

class AdminUser {
  final int id;
  final String username;
  final String role;
  final int createdAt;

  const AdminUser({
    required this.id,
    required this.username,
    required this.role,
    required this.createdAt,
  });

  factory AdminUser.fromJson(Map<String, dynamic> j) => AdminUser(
        id: (j['id'] as num).toInt(),
        username: j['username'] as String,
        role: j['role'] as String,
        createdAt: (j['created_at'] as num?)?.toInt() ?? 0,
      );
}

class Library {
  final int id;
  final String name;
  final String path;

  const Library({required this.id, required this.name, required this.path});

  factory Library.fromJson(Map<String, dynamic> j) => Library(
        id: (j['id'] as num).toInt(),
        name: j['name'] as String,
        path: j['path'] as String,
      );
}

class LyricsLine {
  final int start; // ms
  final String value;

  const LyricsLine({required this.start, required this.value});

  factory LyricsLine.fromJson(Map<String, dynamic> j) => LyricsLine(
        start: (j['start'] as num?)?.toInt() ?? 0,
        value: j['value'] as String? ?? '',
      );
}

class Lyrics {
  final bool synced;
  final List<LyricsLine> line;

  const Lyrics({required this.synced, required this.line});

  factory Lyrics.fromJson(Map<String, dynamic> j) => Lyrics(
        synced: j['synced'] as bool? ?? false,
        line: (j['line'] as List<dynamic>? ?? [])
            .map((l) => LyricsLine.fromJson(l as Map<String, dynamic>))
            .toList(),
      );
}

/// Per-user pin/recency state for a single Library sidebar entry — either a
/// fixed system view (Favourites, Recently Played, ...) or a playlist.
class LibrarySidebarItem {
  final String itemType; // 'system' | 'playlist'
  final String itemKey;
  final DateTime? pinnedAt;
  final DateTime lastInteractedAt;

  const LibrarySidebarItem({
    required this.itemType,
    required this.itemKey,
    this.pinnedAt,
    required this.lastInteractedAt,
  });

  factory LibrarySidebarItem.fromJson(Map<String, dynamic> j) =>
      LibrarySidebarItem(
        itemType: j['itemType'] as String,
        itemKey: j['itemKey'] as String,
        pinnedAt: j['pinnedAt'] != null
            ? DateTime.tryParse(j['pinnedAt'] as String)
            : null,
        lastInteractedAt: DateTime.tryParse(j['lastInteractedAt'] as String) ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

/// A member of this server, as other members see them.
class Person {
  const Person({
    required this.id,
    required this.username,
    required this.displayName,
    this.bio,
    this.hasAvatar = false,
    this.avatarVersion,
    this.isMe = false,
    this.nowListening,
    this.publicPlaylistCount = 0,
    this.playlists = const [],
  });

  final int id;
  final String username;
  final String displayName;
  final String? bio;
  final bool hasAvatar;
  final int? avatarVersion;
  final bool isMe;

  /// What they are playing right now — only present if they chose to share it.
  final Song? nowListening;
  final int publicPlaylistCount;

  /// Only on a full profile: their public playlists (all of them, for your own).
  final List<Playlist> playlists;

  factory Person.fromJson(Map<String, dynamic> j) => Person(
        id: (j['id'] as num).toInt(),
        username: j['username'] as String,
        displayName: j['displayName'] as String? ?? j['username'] as String,
        bio: j['bio'] as String?,
        hasAvatar: j['hasAvatar'] as bool? ?? false,
        avatarVersion: (j['avatarVersion'] as num?)?.toInt(),
        isMe: j['isMe'] as bool? ?? false,
        nowListening: j['nowListening'] == null
            ? null
            : Song.fromJson(j['nowListening'] as Map<String, dynamic>),
        publicPlaylistCount: (j['publicPlaylistCount'] as num?)?.toInt() ?? 0,
        playlists: [
          for (final p in (j['playlists'] as List<dynamic>? ?? const []))
            Playlist.fromJson(p as Map<String, dynamic>)
        ],
      );
}

/// The signed-in user's own profile settings.
class MyProfile {
  const MyProfile({
    this.displayName,
    this.bio,
    this.hasAvatar = false,
    this.avatarVersion,
    this.showListening = false,
  });

  final String? displayName;
  final String? bio;
  final bool hasAvatar;
  final int? avatarVersion;

  /// Off by default — a user turns it on themselves.
  final bool showListening;

  factory MyProfile.fromJson(Map<String, dynamic>? j) => j == null
      ? const MyProfile()
      : MyProfile(
          displayName: j['displayName'] as String?,
          bio: j['bio'] as String?,
          hasAvatar: j['hasAvatar'] as bool? ?? false,
          avatarVersion: (j['avatarVersion'] as num?)?.toInt(),
          showListening: j['showListening'] as bool? ?? false,
        );
}
