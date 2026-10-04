import 'dart:math';
import 'package:audio_service/audio_service.dart';
import 'package:just_audio/just_audio.dart';
import '../api/types.dart';
import '../api/subsonic.dart';
import '../services/download_service.dart';

/// Converts a ReplayGain track-gain dB value into a linear volume multiplier,
/// clamped to just_audio's 0.0-1.0 range. Mirrors the web client's formula
/// (`web/src/store/player.ts`) — there's no master-volume control on mobile
/// to compose it with, so this is the final output volume.
double _replayGainVolume(double? dbGain) {
  if (dbGain == null) return 1.0;
  return pow(10, dbGain / 20).toDouble().clamp(0.0, 1.0);
}

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
  DownloadService downloads,
) async {
  final localPath = await downloads.localPath(song.id);
  final localCoverPath =
      localPath != null ? await downloads.localCoverPath(song.id) : null;
  final uri = localPath != null
      ? Uri.file(localPath)
      : Uri.parse(client.streamUrl(song.id));

  return AudioSource.uri(
    uri,
    tag: songToMediaItem(song, client, localCoverPath: localCoverPath),
  );
}

class RiffPlayerAudioHandler extends BaseAudioHandler
    with QueueHandler, SeekHandler {
  final AudioPlayer _player = AudioPlayer();
  ConcatenatingAudioSource? _queue;

  // The player's output volume is the user's volume (RiffPlayer Connect lets another device set it) times
  // the current track's ReplayGain. There is still no master-volume control: the phone's own media volume
  // is separate and untouched.
  double _userVolume = 1.0;
  double _gain = 1.0;

  RiffPlayerAudioHandler() {
    // Forward playback state to audio_service
    _player.playbackEventStream.map(_transformEvent).pipe(playbackState);

    // Forward current media item to audio_service
    _player.sequenceStateStream.listen((state) {
      if (state == null) return;
      final tag = state.currentSource?.tag;
      if (tag is MediaItem) {
        mediaItem.add(tag);
        _gain =
            _replayGainVolume(tag.extras?['replayGainTrackGain'] as double?);
        _player.setVolume(_userVolume * _gain);
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

  /// The user's volume, 0.0–1.0 (before ReplayGain).
  double get userVolume => _userVolume;

  Future<void> setUserVolume(double volume) {
    _userVolume = volume.clamp(0.0, 1.0);
    return _player.setVolume(_userVolume * _gain);
  }

  // ── Queue management ────────────────────────────────────────────────────────

  /// Replace the queue and start playing from [initialIndex] (at [position], or paused when
  /// [autoplay] is false — used when playback is handed over from another device).
  Future<void> playQueue(
    List<AudioSource> sources,
    int initialIndex, {
    Duration position = Duration.zero,
    bool autoplay = true,
  }) async {
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
    if (_queue == null) {
      await playQueue([source], 0);
      return;
    }
    await _queue!.insert(index, source);
  }

  // ── Shuffle / repeat ─────────────────────────────────────────────────────────
  // Delegated to just_audio's own shuffle/loop support rather than
  // reimplementing queue reordering — it already pins the currently playing
  // item and randomizes the rest, matching the web client's behavior.

  Future<void> setShuffleModeEnabled(bool enabled) =>
      _player.setShuffleModeEnabled(enabled);

  Future<void> setLoopMode(LoopMode mode) => _player.setLoopMode(mode);

  Stream<bool> get shuffleModeEnabledStream => _player.shuffleModeEnabledStream;
  Stream<LoopMode> get loopModeStream => _player.loopModeStream;
  bool get shuffleModeEnabled => _player.shuffleModeEnabled;
  LoopMode get loopMode => _player.loopMode;

  @override
  Future<void> removeQueueItemAt(int index) async {
    await _queue?.removeAt(index);
  }

  Future<void> moveQueueItem(int oldIndex, int newIndex) async {
    await _queue?.move(oldIndex, newIndex);
  }

  Future<void> clearQueue() async {
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
      await _queue?.removeRange(0, index);
    }
  }

  // ── AudioHandler overrides ──────────────────────────────────────────────────

  @override
  Future<void> play() => _player.play();

  @override
  Future<void> pause() => _player.pause();

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

  @override
  Future<void> setShuffleMode(AudioServiceShuffleMode shuffleMode) =>
      setShuffleModeEnabled(shuffleMode != AudioServiceShuffleMode.none);

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
        shuffleMode: _player.shuffleModeEnabled
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
