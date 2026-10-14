import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:just_audio/just_audio.dart';
import '../api/types.dart';
import '../api/subsonic.dart';
import '../services/download_service.dart';
import '../services/stream_cache.dart';
import 'equalizer_model.dart';
import 'interruption_policy.dart';
import 'replay_gain.dart';
import 'shuffle_order.dart';

/// Converts a [Song] into a [MediaItem] for lock-screen / notification
/// display. Prefers [localCoverPath] (a downloaded track's on-disk cover)
/// over a live [SubsonicClient.coverArtUrl] fetch when one's available —
/// keeps lock-screen/notification artwork working while offline instead of
/// silently failing to load a network image.
MediaItem songToMediaItem(
  Song song,
  SubsonicClient client, {
  String? localCoverPath,
}) =>
    MediaItem(
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration:
          song.duration != null ? Duration(seconds: song.duration!) : null,
      artUri: localCoverPath != null
          ? Uri.file(localCoverPath)
          : (song.coverArt != null
              ? Uri.parse(client.coverArtUrl(song.coverArt!, size: 300))
              : null),
      extras: {
        'replayGainTrackGain': song.replayGainTrackGain,
        'replayGainAlbumGain': song.replayGainAlbumGain,
        'songId': song.id,
      },
    );

/// Builds an [AudioSource] for a song, using a local file if downloaded —
/// and, when it is, that download's locally-cached cover art too, so
/// lock-screen/notification artwork doesn't depend on a network fetch for
/// a song that's otherwise playing entirely offline.
Future<AudioSource> buildAudioSource(
  Song song,
  SubsonicClient client,
  DownloadService downloads, {
  StreamCache? cache,
}) async {
  final localPath = await downloads.localPath(song.id);
  final localCoverPath =
      localPath != null ? await downloads.localCoverPath(song.id) : null;
  final tag = songToMediaItem(song, client, localCoverPath: localCoverPath);
  if (localPath != null) return AudioSource.uri(Uri.file(localPath), tag: tag);

  // Not downloaded. With the stream cache on, play the cached copy if there is
  // one, otherwise stream it and keep a copy while it plays.
  if (cache != null && cache.enabled) {
    final cached = await cache.completeFile(song.id, song.suffix);
    if (cached != null) return AudioSource.uri(Uri.file(cached.path), tag: tag);
    await cache.directory.create(recursive: true);
    // ignore: experimental_member_use
    return LockCachingAudioSource(
      Uri.parse(client.streamUrl(song.id)),
      cacheFile: cache.fileFor(song.id, song.suffix),
      tag: tag,
    );
  }
  return AudioSource.uri(Uri.parse(client.streamUrl(song.id)), tag: tag);
}

/// The tag (our [MediaItem]) of a queue entry — what identifies it, by identity,
/// when the original order is restored after shuffling.
Object? sourceTag(AudioSource source) =>
    source is IndexedAudioSource ? source.tag : null;

class RiffPlayerAudioHandler extends BaseAudioHandler
    with QueueHandler, SeekHandler {
  // Android's built-in equalizer (the effect is a no-op on other platforms).
  final AndroidEqualizer _equalizer = AndroidEqualizer();
  // Audio-focus interruptions are handled below (see [InterruptionPolicy]),
  // not by just_audio, which can't resume after a permanent focus loss.
  late final AudioPlayer _player = AudioPlayer(
    handleInterruptions: false,
    audioPipeline: AudioPipeline(androidAudioEffects: [_equalizer]),
  );
  final InterruptionPolicy _interruptions;
  Timer? _interruptionPoll;
  bool _ducked = false;
  ConcatenatingAudioSource? _queue;

  // The player's output volume is the user's volume (RiffPlayer Connect lets another device set it) times
  // the current track's ReplayGain. There is still no master-volume control: the phone's own media volume
  // is separate and untouched.
  double _userVolume = 1.0;
  double _gain = 1.0;

  // ReplayGain settings, and the gains of the track now playing (kept so a settings change applies at once).
  ReplayGainMode _rgMode = ReplayGainMode.track;
  double _preampDb = 0;
  double? _trackGainDb;
  double? _albumGainDb;

  final Random _random;

  // Shuffle is done by reordering the queue itself (see shuffle_order.dart);
  // just_audio's own shuffle mode is never switched on.
  bool _shuffle = false;
  final _shuffleController = StreamController<bool>.broadcast();

  // While shuffled: the queue's entries (their tags) in the order they had
  // before shuffling, so switching shuffle off can put the upcoming songs back.
  List<Object?>? _original;

  RiffPlayerAudioHandler({Random? random, InterruptionPolicy? interruptions})
      : _random = random ?? Random(),
        _interruptions = interruptions ?? InterruptionPolicy() {
    _listenForInterruptions();
    // Forward playback state to audio_service
    // Not pipe(): that locks the subject, and switching shuffle on or off
    // pushes a state of its own (see _setShuffleFlag), which then throws.
    _player.playbackEventStream
        .map(_transformEvent)
        .listen(playbackState.add, onError: playbackState.addError);

    // Forward current media item to audio_service
    _player.sequenceStateStream.listen((state) {
      if (state == null) return;
      final tag = state.currentSource?.tag;
      if (tag is MediaItem) {
        mediaItem.add(tag);
        _trackGainDb = tag.extras?['replayGainTrackGain'] as double?;
        _albumGainDb = tag.extras?['replayGainAlbumGain'] as double?;
        _applyGain();
      }
    });

    // Auto-advance handled by just_audio; expose queue to audio_service
    _player.sequenceStateStream.listen((state) {
      if (state == null) return;
      queue.add(
        state.sequence.map((s) => s.tag).whereType<MediaItem>().toList(),
      );
    });
  }

  // Another app asked us to lower the volume while it speaks/plays briefly.
  static const _duckFactor = 0.3;
  double get _outputVolume =>
      _userVolume * _gain * (_ducked ? _duckFactor : 1.0);

  void _applyGain() {
    _gain = replayGainVolume(
      mode: _rgMode,
      trackGainDb: _trackGainDb,
      albumGainDb: _albumGainDb,
      preampDb: _preampDb,
    );
    _player.setVolume(_outputVolume);
  }

  /// Applies new ReplayGain settings to the track that is playing right now.
  void setReplayGain(ReplayGainMode mode, double preampDb) {
    _rgMode = mode;
    _preampDb = preampDb;
    _applyGain();
  }

  /// The phone's equalizer, for the Equalizer settings.
  EqualizerBackend get equalizerBackend => _AndroidEqualizerBackend(_equalizer);

  /// The user's volume, 0.0–1.0 (before ReplayGain).
  double get userVolume => _userVolume;

  Future<void> setUserVolume(double volume) {
    _userVolume = volume.clamp(0.0, 1.0);
    return _player.setVolume(_outputVolume);
  }

  // ── Audio focus ─────────────────────────────────────────────────────────────

  void _listenForInterruptions() {
    AudioSession.instance.then((session) {
      session.becomingNoisyEventStream.listen((_) {
        _interruptions.userAction();
        _player.pause();
      });
      session.interruptionEventStream.listen((event) {
        final action = event.begin
            ? _interruptions.begin(event.type,
                playing: _player.playing, now: DateTime.now())
            : _interruptions.end(event.type);
        _perform(action);
        _updateInterruptionPoll();
      });
    });
  }

  void _perform(InterruptionAction action) {
    switch (action) {
      case InterruptionAction.none:
        break;
      case InterruptionAction.pause:
        _player.pause();
      case InterruptionAction.resume:
        _player.play();
      case InterruptionAction.duck:
        _ducked = true;
        _player.setVolume(_outputVolume);
      case InterruptionAction.unduck:
        _ducked = false;
        _player.setVolume(_outputVolume);
    }
  }

  // After a permanent focus loss there is no "focus is back" event; look at
  // whether the other app is still playing until it stops (Android only).
  void _updateInterruptionPoll() {
    if (!_interruptions.watching || !Platform.isAndroid) {
      _interruptionPoll?.cancel();
      _interruptionPoll = null;
      return;
    }
    _interruptionPoll ??= Timer.periodic(const Duration(seconds: 2), (_) async {
      final active = await AndroidAudioManager().isMusicActive();
      _perform(
          _interruptions.poll(otherAudioActive: active, now: DateTime.now()));
      _updateInterruptionPoll();
    });
  }

  // ── Queue management ────────────────────────────────────────────────────────

  /// Replace the queue and start playing from [initialIndex] (at [position], or paused when
  /// [autoplay] is false — used when playback is handed over from another device).
  Future<void> playQueue(
    List<AudioSource> sources,
    int initialIndex, {
    Duration position = Duration.zero,
    bool autoplay = true,
    List<Object?>? originalTags,
  }) async {
    // [originalTags]: the entries' tags in the order they had before the caller
    // shuffled [sources] (only meaningful with shuffle on).
    _original =
        _shuffle ? (originalTags ?? sources.map(sourceTag).toList()) : null;
    _queue = ConcatenatingAudioSource(children: sources);
    await _player.setAudioSource(
      _queue!,
      initialIndex: initialIndex,
      initialPosition: position,
    );
    if (autoplay) {
      await _player.play();
    } else {
      await _player.pause();
    }
  }

  /// Insert a track at [index] in the queue.
  Future<void> insertAt(int index, AudioSource source) async {
    final queue = _queue;
    if (queue == null) {
      await playQueue([source], 0);
      return;
    }
    final predecessor = index > 0 && index <= queue.length
        ? sourceTag(queue.children[index - 1])
        : null;
    await queue.insert(index, source);

    final original = _original;
    if (original != null) {
      // Keeps the song where the user put it once shuffle is switched off.
      final at = predecessor == null
          ? -1
          : original.indexWhere((t) => identical(t, predecessor));
      original.insert(at + 1, sourceTag(source));
    }

    // Queue already finished: nothing would pick the new song up by itself.
    if (_player.processingState == ProcessingState.completed &&
        index > (_player.currentIndex ?? -1)) {
      await _player.seek(Duration.zero, index: index);
      await _player.play();
    }
  }

  // ── Shuffle / repeat ─────────────────────────────────────────────────────────

  /// Switches shuffle on or off, reordering the songs after the current one.
  /// Returns the permutation applied to the queue (new item `i` was item
  /// `perm[i]`) so the caller can reorder its own copy, or null when the queue
  /// didn't change. The current song and everything before it never move.
  Future<List<int>?> setShuffleModeEnabled(bool enabled) async {
    if (enabled == _shuffle) return null;
    _setShuffleFlag(enabled);

    final queue = _queue;
    final current = _player.currentIndex;
    if (queue == null || current == null) {
      _original = null;
      return null;
    }
    final children = List.of(queue.children);
    final tags = children.map(sourceTag).toList();
    final List<int> perm;
    if (enabled) {
      _original = tags;
      perm = shuffleUpcoming(children.length, current, _random);
    } else {
      final original = _original;
      _original = null;
      if (original == null) return null;
      perm = restoreUpcoming(tags, current, original);
    }
    if (isIdentity(perm)) return null;

    // Only what follows the current song is replaced, so playback and the
    // current index are untouched.
    final upcoming = [
      for (var i = current + 1; i < perm.length; i++) children[perm[i]],
    ];
    await queue.removeRange(current + 1, children.length);
    await queue.addAll(upcoming);
    return perm;
  }

  /// Only records the mode, without touching the queue — used while a queue
  /// handed over from another device is about to be loaded in its play order.
  void applyShuffleFlag(bool enabled) => _setShuffleFlag(enabled);

  void _setShuffleFlag(bool enabled) {
    if (_shuffle == enabled) return;
    _shuffle = enabled;
    _shuffleController.add(enabled);
    playbackState.add(playbackState.value.copyWith(
      shuffleMode:
          enabled ? AudioServiceShuffleMode.all : AudioServiceShuffleMode.none,
    ));
  }

  Future<void> setLoopMode(LoopMode mode) => _player.setLoopMode(mode);

  Stream<bool> get shuffleModeEnabledStream => _shuffleController.stream;
  Stream<LoopMode> get loopModeStream => _player.loopModeStream;
  bool get shuffleModeEnabled => _shuffle;
  LoopMode get loopMode => _player.loopMode;

  @override
  Future<void> removeQueueItemAt(int index) async {
    final queue = _queue;
    if (queue == null) return;
    _forget(queue.children.sublist(index, index + 1));
    await queue.removeAt(index);
  }

  /// Drops [sources] from the remembered original order.
  void _forget(Iterable<AudioSource> sources) {
    final original = _original;
    if (original == null) return;
    for (final s in sources) {
      final tag = sourceTag(s);
      original.removeWhere((t) => identical(t, tag));
    }
  }

  Future<void> moveQueueItem(int oldIndex, int newIndex) async {
    await _queue?.move(oldIndex, newIndex);
  }

  Future<void> clearQueue() async {
    _original = null;
    await _queue?.clear();
    await _player.stop();
  }

  /// Seeks to [index] first, then removes everything before it — order
  /// matters: trimming first would shift [index] out from under itself.
  /// just_audio adjusts the player's current-item tracking automatically
  /// when items ahead of it are removed, so the seeked-to track keeps
  /// playing uninterrupted once the removal completes.
  Future<void> playFromIndex(int index) async {
    await _player.seek(Duration.zero, index: index);
    if (index > 0) {
      _forget(_queue?.children.sublist(0, index) ?? const []);
      await _queue?.removeRange(0, index);
    }
  }

  // ── AudioHandler overrides ──────────────────────────────────────────────────

  @override
  Future<void> play() {
    _interruptions.userAction();
    _updateInterruptionPoll();
    return _player.play();
  }

  @override
  Future<void> pause() {
    _interruptions.userAction();
    _updateInterruptionPoll();
    return _player.pause();
  }

  @override
  Future<void> seek(Duration position) => _player.seek(position);

  @override
  Future<void> skipToNext() => _player.seekToNext();

  @override
  Future<void> skipToPrevious() {
    // If more than 3 seconds in, restart; otherwise go to previous
    if (_player.position > const Duration(seconds: 3)) {
      return _player.seek(Duration.zero);
    }
    return _player.seekToPrevious();
  }

  @override
  Future<void> skipToQueueItem(int index) =>
      _player.seek(Duration.zero, index: index);

  // Not offered to the system (no shuffle action in [systemActions]), and the
  // app's own queue copy would not follow a reorder made from here — so
  // shuffle is only ever switched through [PlayerNotifier.toggleShuffle].
  @override
  Future<void> setShuffleMode(AudioServiceShuffleMode shuffleMode) async {}

  @override
  Future<void> setRepeatMode(AudioServiceRepeatMode repeatMode) =>
      setLoopMode(const {
        AudioServiceRepeatMode.none: LoopMode.off,
        AudioServiceRepeatMode.one: LoopMode.one,
        AudioServiceRepeatMode.all: LoopMode.all,
        AudioServiceRepeatMode.group: LoopMode.all,
      }[repeatMode]!);

  @override
  Future<void> stop() async {
    _interruptions.userAction();
    _updateInterruptionPoll();
    await _player.stop();
    await super.stop();
  }

  @override
  Future<void> onTaskRemoved() => stop();

  // ── State transform ─────────────────────────────────────────────────────────

  PlaybackState _transformEvent(PlaybackEvent event) => PlaybackState(
        controls: [
          MediaControl.skipToPrevious,
          if (_player.playing) MediaControl.pause else MediaControl.play,
          MediaControl.skipToNext,
        ],
        systemActions: const {
          MediaAction.seek,
          MediaAction.seekForward,
          MediaAction.seekBackward,
          MediaAction.skipToNext,
          MediaAction.skipToPrevious,
        },
        androidCompactActionIndices: const [0, 1, 2],
        processingState: const {
          ProcessingState.idle: AudioProcessingState.idle,
          ProcessingState.loading: AudioProcessingState.loading,
          ProcessingState.buffering: AudioProcessingState.buffering,
          ProcessingState.ready: AudioProcessingState.ready,
          ProcessingState.completed: AudioProcessingState.completed,
        }[_player.processingState]!,
        playing: _player.playing,
        updatePosition: _player.position,
        bufferedPosition: _player.bufferedPosition,
        speed: _player.speed,
        queueIndex: event.currentIndex,
        shuffleMode: _shuffle
            ? AudioServiceShuffleMode.all
            : AudioServiceShuffleMode.none,
        repeatMode: const {
          LoopMode.off: AudioServiceRepeatMode.none,
          LoopMode.one: AudioServiceRepeatMode.one,
          LoopMode.all: AudioServiceRepeatMode.all,
        }[_player.loopMode]!,
      );

  // ── Expose player streams ───────────────────────────────────────────────────

  Stream<Duration> get positionStream => _player.positionStream;
  Stream<Duration?> get durationStream => _player.durationStream;
  Stream<bool> get playingStream => _player.playingStream;
  Stream<int?> get currentIndexStream => _player.currentIndexStream;
  bool get playing => _player.playing;
  Duration get position => _player.position;
  Duration? get duration => _player.duration;
}

class _AndroidEqualizerBackend implements EqualizerBackend {
  _AndroidEqualizerBackend(this._eq);
  final AndroidEqualizer _eq;

  @override
  Future<EqBands?> bands() async {
    try {
      // Completes only once the player has been activated (audio loaded).
      final p = await _eq.parameters.timeout(const Duration(milliseconds: 400));
      return EqBands(
        [for (final b in p.bands) b.centerFrequency],
        p.minDecibels,
        p.maxDecibels,
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> setEnabled(bool enabled) => _eq.setEnabled(enabled);

  @override
  Future<void> setGain(int band, double db) async {
    final p = await _eq.parameters;
    if (band >= 0 && band < p.bands.length) await p.bands[band].setGain(db);
  }
}
