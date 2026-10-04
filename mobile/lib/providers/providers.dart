import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import '../api/types.dart';
import '../api/subsonic.dart';
import '../services/auth_service.dart';
import '../services/download_service.dart';
import '../audio/audio_handler.dart';
import '../connect/connect_models.dart' show CommandType;
import '../connect/remote_controller.dart';

// ── Services ──────────────────────────────────────────────────────────────────

final authServiceProvider = Provider((_) => AuthService());
final downloadServiceProvider = Provider((_) => DownloadService());

// ── Audio handler (overridden in main with the initialized singleton) ─────────

final audioHandlerProvider = Provider<RiffPlayerAudioHandler>(
  (_) => throw UnimplementedError('Override in ProviderScope'),
);

// ── Auth ──────────────────────────────────────────────────────────────────────

class AuthNotifier extends StateNotifier<AsyncValue<Credentials?>> {
  final AuthService _svc;

  AuthNotifier(this._svc) : super(const AsyncValue.loading()) {
    _load();
  }

  Future<void> _load() async {
    state = AsyncValue.data(await _svc.load());
  }

  Future<void> login(Credentials creds) async {
    // Verify credentials by pinging
    final client = SubsonicClient(creds);
    await client.ping();

    // Optionally get a JWT from the custom API
    Credentials saved = creds;
    try {
      final r = await client.loginCustomApi(creds.username, creds.password);
      if (r != null) saved = creds.copyWith(token: r);
    } catch (_) {
      // JWT login optional — Subsonic auth still works
    }

    await _svc.save(saved);
    state = AsyncValue.data(saved);
  }

  /// Signs in a device that was linked with a code: it already holds a session token and an API key
  /// (and never the password), so there is nothing to exchange.
  Future<void> loginLinked(Credentials creds) async {
    await _svc.save(creds);
    state = AsyncValue.data(creds);
  }

  Future<void> logout() async {
    await _svc.clear();
    state = const AsyncValue.data(null);
  }
}

final authProvider =
    StateNotifierProvider<AuthNotifier, AsyncValue<Credentials?>>(
  (ref) => AuthNotifier(ref.read(authServiceProvider)),
);

// ── API client derived from credentials ───────────────────────────────────────

final apiClientProvider = Provider<SubsonicClient?>((ref) {
  final auth = ref.watch(authProvider);
  return auth.valueOrNull != null ? SubsonicClient(auth.valueOrNull!) : null;
});

// ── Player state ──────────────────────────────────────────────────────────────

class PlayerState {
  final List<Song> queue;
  final int currentIndex;
  final bool playing;
  final Duration position;
  final Duration duration;
  final bool shuffle;
  final LoopMode repeatMode;

  const PlayerState({
    this.queue = const [],
    this.currentIndex = -1,
    this.playing = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.shuffle = false,
    this.repeatMode = LoopMode.off,
  });

  Song? get currentSong => currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : null;

  PlayerState copyWith({
    List<Song>? queue,
    int? currentIndex,
    bool? playing,
    Duration? position,
    Duration? duration,
    bool? shuffle,
    LoopMode? repeatMode,
  }) =>
      PlayerState(
        queue: queue ?? this.queue,
        currentIndex: currentIndex ?? this.currentIndex,
        playing: playing ?? this.playing,
        position: position ?? this.position,
        duration: duration ?? this.duration,
        shuffle: shuffle ?? this.shuffle,
        repeatMode: repeatMode ?? this.repeatMode,
      );
}

class PlayerNotifier extends StateNotifier<PlayerState> {
  final RiffPlayerAudioHandler _handler;

  // "Now playing" scrobbles fire immediately in playSong(); this tracks the
  // one-time "submission" scrobble (counts as a real play) sent once a track
  // crosses 50% played or 30s, whichever comes first — same rule as the web
  // client, so play counts / Wrapped / Most Played agree across platforms.
  SubsonicClient? _scrobbleClient;
  String? _scrobbledSongId;
  String? _nowPlayingSongId;
  Duration _lastPosition = Duration.zero;

  // Replay detection that doesn't depend on the position stream. Some players
  // keep reporting the last position (clamped to the track length) while a
  // repeat-one loop plays on, so the loop can't always be seen as a position
  // jump. Instead, after a submission we add up how long playback actually
  // runs; once that covers the rest of the track plus the threshold into the
  // next pass, it counts as another play.
  final DateTime Function() _now;

  /// Set by RiffPlayer Connect: while another device is playing, the transport actions below become
  /// remote commands instead of driving the local player.
  RemoteController? remote;

  /// True while the state shown is another device's playback (Connect mirror mode); the local player's
  /// own event streams are then ignored so they can't overwrite it.
  bool _remoteMirror = false;
  bool get isMirroring => _remoteMirror;
  DateTime? _lastTickAt;
  int _listenedSinceSubmitMs = 0;
  int _submitPositionMs = 0;
  // Gaps longer than this between two position ticks (app suspended, stream
  // stalled) are not counted as listening time.
  static const _maxTickGapMs = 1500;

  // How many songs "Add to queue" has inserted directly after the current
  // one, in this run — the next addition goes after all of them, so
  // queueing A then B plays A before B instead of each jumping to right
  // after current (which would play B before A). Reset to 0 whenever the
  // current track changes for any reason, since a new "next block" starts
  // fresh relative to whatever's now playing.
  int _queuedCount = 0;

  // Chains every queue-mutating method below (addToQueue/removeFromQueue/
  // reorderQueue/clearQueue/playFromQueueIndex) onto one another so they can
  // never run concurrently — see the comment on addToQueue() for why that
  // matters. setStarredInQueue() is excluded: it's a single synchronous
  // state update with no `await` in it, so it can't race with anything.
  Future<void> _queueOpChain = Future.value();

  Future<T> _serializeQueueOp<T>(Future<T> Function() op) {
    final result = _queueOpChain.then((_) => op());
    _queueOpChain = result.then((_) {}, onError: (_) {});
    return result;
  }

  PlayerNotifier(this._handler, {DateTime Function()? now})
      : _now = now ?? DateTime.now,
        super(const PlayerState()) {
    _handler.positionStream.listen((pos) {
      if (_remoteMirror) return;
      state = state.copyWith(position: pos);
      _maybeScrobble(pos);
    });
    _handler.durationStream.listen((dur) {
      if (_remoteMirror) return;
      state = state.copyWith(duration: dur ?? Duration.zero);
    });
    _handler.playingStream.listen((playing) {
      if (_remoteMirror) return;
      state = state.copyWith(playing: playing);
    });
    _handler.currentIndexStream.listen((idx) {
      if (_remoteMirror) return;
      state = state.copyWith(currentIndex: idx ?? -1);
      _queuedCount = 0;
      _listenedSinceSubmitMs = 0;
      // Skipping (next/previous/tap-in-queue) changes the track without going
      // through playSong() — send its "now playing" scrobble here instead.
      final song = state.currentSong;
      final client = _scrobbleClient;
      if (song != null && client != null && _nowPlayingSongId != song.id) {
        _nowPlayingSongId = song.id;
        client.scrobble(song.id, submission: false).ignore();
      }
    });
    _handler.shuffleModeEnabledStream.listen((enabled) {
      if (_remoteMirror) return;
      state = state.copyWith(shuffle: enabled);
    });
    _handler.loopModeStream.listen((mode) {
      if (_remoteMirror) return;
      state = state.copyWith(repeatMode: mode);
    });
  }

  Future<void> playSong(
    Song song,
    SubsonicClient client,
    DownloadService downloads, {
    List<Song>? queue,
    int? queueIndex,
  }) async {
    // Starting something here while another device plays is a takeover (Connect).
    remote?.onLocalStart();
    final songs = queue ?? [song];
    final idx = queueIndex ?? songs.indexWhere((s) => s.id == song.id);
    final resolvedIndex = idx < 0 ? 0 : idx;

    final sources = await Future.wait(
      songs.map((s) => buildAudioSource(s, client, downloads)),
    );

    // Update the UI-facing state (and fire the scrobble) before waiting on
    // playback to actually start, not after — `_handler.playQueue()` awaits
    // just_audio's `setAudioSource`/`play()`, which on a slow/flaky network
    // response can take an unpredictable while to resolve even though
    // playback is genuinely starting. Gating the mini-player etc. on that
    // full round-trip made it appear to hang with nothing showing as
    // playing even once audio was already audible.
    state = state.copyWith(queue: songs, currentIndex: resolvedIndex);
    _scrobbleClient = client;
    _nowPlayingSongId = song.id;
    // An explicit play is a new play, even of the song that just finished.
    _scrobbledSongId = null;
    _listenedSinceSubmitMs = 0;
    client.scrobble(song.id, submission: false).ignore();

    await _handler.playQueue(sources, resolvedIndex);
  }

  void _maybeScrobble(Duration pos) {
    final previous = _lastPosition;
    _lastPosition = pos;

    // Wall-clock time since the previous tick, counted as listening only while
    // playing and only when the gap is plausible.
    final tickAt = _now();
    final gapMs = _lastTickAt == null
        ? 0
        : tickAt.difference(_lastTickAt!).inMilliseconds;
    _lastTickAt = tickAt;
    if (state.playing && gapMs > 0 && gapMs <= _maxTickGapMs) {
      _listenedSinceSubmitMs += gapMs;
    }

    // Repeat-one restarts the same track without changing the index, so
    // detect the loop (position jumps from the very end back to the very
    // start) and count the next pass as a new play. A plain seek backwards
    // doesn't match this and stays one play.
    final durationMs = state.duration.inMilliseconds;
    if (durationMs > 0 &&
        previous.inMilliseconds >= durationMs - 3000 &&
        pos.inMilliseconds < 3000) {
      _scrobbledSongId = null;
    }
    final song = state.currentSong;
    final client = _scrobbleClient;
    if (song == null || client == null) return;
    final thresholdMs =
        durationMs > 0 ? (durationMs * 0.5).clamp(0, 30000).round() : 30000;

    if (_scrobbledSongId == song.id) {
      // Already counted this pass. Count another one if playback has run for
      // the remainder of the track plus the threshold into the next pass.
      if (durationMs > 0 &&
          _listenedSinceSubmitMs >=
              (durationMs - _submitPositionMs) + thresholdMs) {
        _listenedSinceSubmitMs = 0;
        // We are now `thresholdMs` into a pass, whatever the player reports.
        _submitPositionMs = thresholdMs;
        client.scrobble(song.id, submission: true).ignore();
      }
      return;
    }

    if (pos.inMilliseconds >= thresholdMs) {
      _scrobbledSongId = song.id;
      _listenedSinceSubmitMs = 0;
      _submitPositionMs = pos.inMilliseconds;
      client.scrobble(song.id, submission: true).ignore();
    }
  }

  // Every method below reads `state.queue` and writes the updated list back
  // in the same synchronous expression (never via an intermediate variable
  // held across an `await`). Dart's single-threaded event loop means that
  // synchronous span can't be interrupted, so two calls started in quick
  // succession (e.g. tapping "Add to queue" on two songs back to back) can
  // never read each other's stale pre-await snapshot and clobber one
  // another — a real bug an earlier version of this class had via a
  // separately-tracked `_songs` list.

  /// Inserts [song] right after the current track, or after any songs
  /// already added this way — so adding A then B plays current → A → B.
  ///
  /// Unlike the file-header comment's stated invariant for this class, this
  /// method (and its siblings below) *do* hold state across an `await`:
  /// e.g. here, `insertAt` is derived from `state.currentIndex`/
  /// `_queuedCount` before awaiting `_handler.insertAt()`, then combined
  /// with a freshly-read `state.queue` afterward. Two calls started close
  /// together — e.g. flutter_slidable's swipe-to-queue dispatching both its
  /// `confirmDismiss` and `SlidableAction.onPressed` for one gesture, or a
  /// queue-add racing a `clearQueue()`/`removeFromQueue()` — could race
  /// there: the second call's pre-await index goes stale once the first
  /// call's post-await state write lands, up to indexing past a
  /// `state.queue` snapshot that's now shorter than expected and throwing a
  /// RangeError, silently dropping the operation. `_serializeQueueOp` makes
  /// every queue-mutating call below run strictly one at a time instead, so
  /// each one's `state` reads are always current by the time it uses them.
  Future<void> addToQueue(
    Song song,
    SubsonicClient client,
    DownloadService downloads,
  ) {
    final r = remote;
    if (r != null && r.isRemote) {
      // The other device's queue, not this one's: "Add to queue" lands where the music is playing.
      r.queueAdd(song);
      return Future.value();
    }
    return _serializeQueueOp(() => _addToQueueLocked(song, client, downloads));
  }

  /// Appends [song] to the very end of the queue (Connect's "add to the end"; [addToQueue] puts it next).
  Future<void> addToQueueEnd(
    Song song,
    SubsonicClient client,
    DownloadService downloads,
  ) =>
      _serializeQueueOp(() async {
        final source = await buildAudioSource(song, client, downloads);
        if (state.currentIndex < 0 || state.queue.isEmpty) {
          await _addToQueueLocked(song, client, downloads);
          return;
        }
        await _handler.insertAt(state.queue.length, source);
        state = state.copyWith(queue: [...state.queue, song]);
      });

  Future<void> _addToQueueLocked(
    Song song,
    SubsonicClient client,
    DownloadService downloads,
  ) async {
    final source = await buildAudioSource(song, client, downloads);
    if (state.currentIndex < 0) {
      // Nothing playing — this starts it from scratch.
      await _handler.insertAt(0, source);
      state = state.copyWith(queue: [song], currentIndex: 0);
      _scrobbleClient = client;
      _nowPlayingSongId = song.id;
      client.scrobble(song.id, submission: false).ignore();
      return;
    }
    final insertAt = state.currentIndex + 1 + _queuedCount;
    await _handler.insertAt(insertAt, source);
    final current = state.queue;
    state = state.copyWith(
      queue: [
        ...current.sublist(0, insertAt),
        song,
        ...current.sublist(insertAt)
      ],
    );
    _queuedCount++;
  }

  Future<void> removeFromQueue(int index) {
    final r = remote;
    if (r != null && r.isRemote) {
      r.queueRemove(index);
      return Future.value();
    }
    return _removeFromQueueLocal(index);
  }

  Future<void> _removeFromQueueLocal(int index) => _serializeQueueOp(() async {
        await _handler.removeQueueItemAt(index);
        final newSongs = [...state.queue]..removeAt(index);
        int newIdx = state.currentIndex;
        if (index < newIdx) newIdx--;
        state = state.copyWith(queue: newSongs, currentIndex: newIdx);
      });

  Future<void> reorderQueue(int from, int to) {
    final r = remote;
    if (r != null && r.isRemote) {
      r.queueMove(from, to);
      return Future.value();
    }
    return _reorderQueueLocal(from, to);
  }

  Future<void> _reorderQueueLocal(int from, int to) =>
      _serializeQueueOp(() async {
        await _handler.moveQueueItem(from, to);
        final newSongs = [...state.queue];
        final moved = newSongs.removeAt(from);
        newSongs.insert(to, moved);
        state = state.copyWith(queue: newSongs);
      });

  Future<void> clearQueue() => _serializeQueueOp(() async {
        await _handler.clearQueue();
        _queuedCount = 0;
        state = state.copyWith(queue: [], currentIndex: -1, playing: false);
      });

  /// Jumps playback to [index] within the queue and permanently drops
  /// everything before it — tapping a song further down "Up Next" plays it
  /// and discards the skipped-over tracks, matching Spotify's queue model.
  Future<void> playFromQueueIndex(int index) => _serializeQueueOp(() async {
        await _handler.playFromIndex(index);
        state =
            state.copyWith(queue: state.queue.sublist(index), currentIndex: 0);
      });

  /// Updates the starred status of every queue entry matching [songId] in
  /// place — the player screen's favorite icon reads `currentSong.isStarred`
  /// straight off the queue, not off `starredProvider`, so star/unstar
  /// there needs to patch this state directly to show up immediately.
  void setStarredInQueue(String songId, String? starred) {
    final newQueue = [
      for (final s in state.queue) s.id == songId ? s.withStarred(starred) : s,
    ];
    state = state.copyWith(queue: newQueue);
  }

  // The player's own volume (before ReplayGain), 0.0–1.0. Kept here so reading it never touches the audio
  // handler. Session-only: a restart is back at full volume rather than silently quiet.
  double _volume = 1.0;
  double get volume => _volume;

  /// Sets this device's player volume — what another device's volume control drives (Connect). While another
  /// device is the one playing, the device picker's slider drives *its* volume instead.
  Future<void> setVolume(double volume) {
    _volume = volume.clamp(0.0, 1.0);
    return _handler.setUserVolume(_volume);
  }

  void play() {
    final r = remote;
    if (r != null && r.isRemote) return r.command(CommandType.play);
    _handler.play();
  }

  void pause() {
    final r = remote;
    if (r != null && r.isRemote) return r.command(CommandType.pause);
    _handler.pause();
  }

  void seek(Duration pos) {
    final r = remote;
    if (r != null && r.isRemote) {
      state = state.copyWith(
          position: pos); // show it at once; the real position follows
      return r.command(CommandType.seek, positionMs: pos.inMilliseconds);
    }
    _handler.seek(pos);
  }

  void next() {
    final r = remote;
    if (r != null && r.isRemote) return r.command(CommandType.next);
    _handler.skipToNext();
  }

  void previous() {
    final r = remote;
    if (r != null && r.isRemote) return r.command(CommandType.previous);
    _handler.skipToPrevious();
  }

  // ── RiffPlayer Connect ──────────────────────────────────────────────────────

  /// Silences the local player without touching the queue (never forwarded).
  void pauseLocal() => _handler.pause();

  /// Shows another device's playback in place of the local one.
  void applyRemoteMirror({
    required Song? song,
    required bool playing,
    required Duration position,
    required Duration duration,
    required LoopMode repeat,
    required bool shuffle,
  }) {
    _remoteMirror = true;
    state = PlayerState(
      queue: song == null ? const [] : [song],
      currentIndex: song == null ? -1 : 0,
      playing: playing,
      position: position,
      duration: duration,
      shuffle: shuffle,
      repeatMode: repeat,
    );
  }

  /// Goes back to showing the local player (the mirrored state is dropped unless [clear] is false).
  void leaveRemoteMirror({bool clear = true}) {
    if (!_remoteMirror) return;
    _remoteMirror = false;
    if (clear) state = const PlayerState();
  }

  /// Repeat/shuffle taken over from the device that was playing.
  Future<void> applyModes(
      {required LoopMode repeat, required bool shuffle}) async {
    await _handler.setLoopMode(repeat);
    await _handler.setShuffleModeEnabled(shuffle);
  }

  /// Whether the track now loaded has already been counted as a play (scrobbled) — handed to the
  /// device that takes over so a transfer mid-song doesn't count the same listen twice.
  bool get currentPlayCounted {
    final song = state.currentSong;
    return song != null && _scrobbledSongId == song.id;
  }

  /// Loads a queue handed over from another device, at [position], playing only if [play].
  Future<void> restoreQueue(
    List<Song> songs,
    int index,
    Duration position, {
    required bool play,
    required bool counted,
    required SubsonicClient client,
    required DownloadService downloads,
  }) async {
    if (songs.isEmpty) return;
    final i = index.clamp(0, songs.length - 1);
    final sources = await Future.wait(
      songs.map((s) => buildAudioSource(s, client, downloads)),
    );
    _remoteMirror = false;
    state = state.copyWith(
      queue: songs,
      currentIndex: i,
      position: position,
      playing: false,
    );
    _scrobbleClient = client;
    _scrobbledSongId = counted ? songs[i].id : null;
    _listenedSinceSubmitMs = 0;
    _lastPosition = position;
    _queuedCount = 0;
    if (play) {
      _nowPlayingSongId = songs[i].id;
      client.scrobble(songs[i].id, submission: false).ignore();
    }
    await _handler.playQueue(sources, i, position: position, autoplay: play);
  }

  void toggleShuffle() => _handler.setShuffleModeEnabled(!state.shuffle);

  /// Cycles off → all → one → off, same order as the web client.
  void toggleRepeat() {
    const order = [LoopMode.off, LoopMode.all, LoopMode.one];
    final next = order[(order.indexOf(state.repeatMode) + 1) % order.length];
    _handler.setLoopMode(next);
  }
}

final playerProvider = StateNotifierProvider<PlayerNotifier, PlayerState>(
  (ref) => PlayerNotifier(ref.read(audioHandlerProvider)),
);

// ── Library data providers ─────────────────────────────────────────────────────

final albumListProvider =
    FutureProvider.autoDispose.family<List<Album>, String>((ref, type) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getAlbumList(type);
});

/// Albums filtered by audio quality ('lossless' | 'hires'); [quality] null = no filter.
final filteredAlbumListProvider = FutureProvider.autoDispose
    .family<List<Album>, ({String type, String? quality})>((ref, key) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getAlbumList(key.type, quality: key.quality);
});

/// Credits for a track, fetched when its info dialog opens. Any failure (the file
/// unreadable, offline) simply means there are no credits to show.
final trackCreditsProvider = FutureProvider.autoDispose
    .family<List<(String, String)>, String>((ref, id) async {
  final client = ref.read(apiClientProvider);
  if (client == null) return const [];
  try {
    return await client.getTrackCredits(id);
  } catch (_) {
    return const [];
  }
});

final artistsProvider =
    FutureProvider.autoDispose<List<ArtistIndex>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getArtists();
});

final artistDetailProvider = FutureProvider.autoDispose
    .family<({Artist artist, List<Album> albums}), String>((ref, id) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getArtistDetail(id);
});

/// All songs across every album by this artist, flattened — backs the
/// artist detail screen's "Songs" tab.
final artistSongsProvider = FutureProvider.autoDispose
    .family<List<Song>, String>((ref, artistId) async {
  // Without this the provider tears down and refetches from scratch every
  // time the tab is re-entered (autoDispose's default). Keeping it alive
  // for a few minutes after the last listener unsubscribes means quickly
  // flipping back to a recently-viewed artist's Songs tab reuses the
  // cached result instead of re-fetching every album again.
  final link = ref.keepAlive();
  final timer = Timer(const Duration(minutes: 5), link.close);
  ref.onDispose(timer.cancel);

  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  final detail = await client.getArtistDetail(artistId);

  // Fetched in bounded-concurrency batches rather than firing every
  // album's request at once — a prolific artist (20+ albums) would
  // otherwise burst that many simultaneous network calls on one tab open.
  const batchSize = 5;
  final results = <({Album album, List<Song> songs})>[];
  for (var i = 0; i < detail.albums.length; i += batchSize) {
    final batch = detail.albums.skip(i).take(batchSize);
    results.addAll(await Future.wait(batch.map((a) => client.getAlbum(a.id))));
  }
  return results.expand((r) => r.songs).toList();
});

final albumDetailProvider = FutureProvider.autoDispose
    .family<({Album album, List<Song> songs}), String>((ref, id) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getAlbum(id);
});

final searchProvider =
    FutureProvider.autoDispose.family<SearchResult, String>((ref, query) async {
  if (query.isEmpty) {
    return const SearchResult(artists: [], albums: [], songs: []);
  }
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.search(query);
});

final starredProvider = FutureProvider.autoDispose<
    ({
      List<Artist> artists,
      List<Album> albums,
      List<Song> songs
    })>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getStarred();
});

final playlistsProvider =
    FutureProvider.autoDispose<List<Playlist>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getPlaylists();
});

final playlistDetailProvider =
    FutureProvider.autoDispose.family<Playlist, String>((ref, id) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getPlaylist(id);
});

/// When each track was added to this playlist — drives the "date added"
/// column and the "sort by date added" view on the playlist detail screen.
final playlistTrackDatesProvider = FutureProvider.autoDispose
    .family<Map<String, DateTime>, String>((ref, id) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getPlaylistTrackDates(id);
});

final downloadsProvider =
    FutureProvider.autoDispose<List<DownloadedTrack>>((ref) async {
  return ref.read(downloadServiceProvider).getDownloads();
});

final downloadedPlaylistsProvider =
    FutureProvider.autoDispose<List<DownloadedPlaylist>>((ref) async {
  return ref.read(downloadServiceProvider).getDownloadedPlaylists();
});

final downloadedPlaylistProvider = FutureProvider.autoDispose
    .family<DownloadedPlaylist?, String>((ref, playlistId) async {
  return ref.read(downloadServiceProvider).getDownloadedPlaylist(playlistId);
});

final downloadedPlaylistTracksProvider = FutureProvider.autoDispose
    .family<List<DownloadedTrack>, String>((ref, playlistId) async {
  return ref
      .read(downloadServiceProvider)
      .getDownloadedPlaylistTracks(playlistId);
});

final lyricsProvider =
    FutureProvider.autoDispose.family<Lyrics?, String>((ref, songId) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getLyrics(songId);
});

/// Whether the full-screen player is currently showing the lyrics view
/// instead of the cover art.
final showLyricsProvider = StateProvider.autoDispose<bool>((ref) => false);

/// Per-user pin/recency state for the unified Library list (see
/// `screens/library_screen.dart` and `utils/library_sidebar_order.dart`).
final librarySidebarStateProvider =
    FutureProvider.autoDispose<List<LibrarySidebarItem>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getLibrarySidebarState();
});

// ── Home page ─────────────────────────────────────────────────────────────────

final lastPlayedProvider = FutureProvider.autoDispose<Song?>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getLastPlayed();
});

final mostPlayedProvider = FutureProvider.autoDispose<List<Song>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getMostPlayed();
});

final recentlyPlayedProvider =
    FutureProvider.autoDispose<List<Song>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getRecentlyPlayed();
});

final rediscoverProvider = FutureProvider.autoDispose<List<Song>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getRediscover();
});

// ── Wrapped & Discover ───────────────────────────────────────────────────────

final wrappedProvider =
    FutureProvider.autoDispose.family<WrappedStats, int>((ref, year) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getWrapped(year: year);
});

/// 'similar' or 'discover'.
final recommendationsProvider = FutureProvider.autoDispose
    .family<RecommendationsResult, String>((ref, type) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getRecommendations(type);
});

final socialEnabledProvider = FutureProvider.autoDispose<bool>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) return false;
  return client.getSocialEnabled();
});

final peopleProvider = FutureProvider.autoDispose<List<Person>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getPeople();
});

final personProvider =
    FutureProvider.autoDispose.family<Person, int>((ref, id) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getPerson(id);
});

final myProfileProvider = FutureProvider.autoDispose<MyProfile>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getMyProfile();
});

final weeklyDiscoveryProvider =
    FutureProvider.autoDispose<WeeklyDiscovery>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getWeeklyDiscovery();
});

// ── Account & admin ─────────────────────────────────────────────────────────

final meProvider = FutureProvider.autoDispose<MeInfo>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.getMe();
});

final adminUsersProvider =
    FutureProvider.autoDispose<List<AdminUser>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.adminGetUsers();
});

final adminLibrariesProvider =
    FutureProvider.autoDispose<List<Library>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.adminGetLibraries();
});

final adminSettingsProvider =
    FutureProvider.autoDispose<Map<String, String>>((ref) async {
  final client = ref.read(apiClientProvider);
  if (client == null) throw Exception('Not authenticated');
  return client.adminGetSettings();
});
