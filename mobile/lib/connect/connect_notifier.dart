// RiffPlayer Connect — the Android client's side of multi-device control (docs/CONNECT-DESIGN.md).
//
// While the user is signed in this keeps a live connection to /api/v1/connect (an SSE stream, with a
// long-poll fallback), mirrors what the *active* device plays into the normal player state, forwards the
// transport actions as commands while another device is playing, executes commands/handovers when this
// device is the one playing, and reports this device's playback so the others can mirror it.
// It is the Dart counterpart of web/src/store/connect.ts and follows the same rules.

import 'dart:async';
import 'dart:math' show max;
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart' show LoopMode;
import '../api/subsonic.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../services/download_service.dart';
import 'connect_api.dart';
import 'connect_models.dart';
import 'connect_prefs.dart';
import 'remote_controller.dart';
import 'remote_queue.dart';

enum ConnectStatus { idle, connecting, online, offline, unavailable }

const _keep = Object();

class ConnectState {
  final ConnectStatus status;

  /// True once streams proved to be buffered somewhere on the path and long-polling is used instead.
  final bool polling;
  final String deviceId;
  final String deviceName;
  final List<DeviceInfo> devices;
  final String? activeDeviceId;

  /// What the active device last reported (also while it is this device).
  final PublicState? remote;

  /// The other device's queue, kept fresh while something (the Queue screen) is watching it.
  final RemoteQueueView? remoteQueue;

  const ConnectState({
    this.status = ConnectStatus.idle,
    this.polling = false,
    this.deviceId = '',
    this.deviceName = '',
    this.devices = const [],
    this.activeDeviceId,
    this.remote,
    this.remoteQueue,
  });

  ConnectState copyWith({
    ConnectStatus? status,
    bool? polling,
    String? deviceId,
    String? deviceName,
    List<DeviceInfo>? devices,
    Object? activeDeviceId = _keep,
    Object? remote = _keep,
    Object? remoteQueue = _keep,
  }) =>
      ConnectState(
        status: status ?? this.status,
        polling: polling ?? this.polling,
        deviceId: deviceId ?? this.deviceId,
        deviceName: deviceName ?? this.deviceName,
        devices: devices ?? this.devices,
        activeDeviceId: identical(activeDeviceId, _keep)
            ? this.activeDeviceId
            : activeDeviceId as String?,
        remote: identical(remote, _keep) ? this.remote : remote as PublicState?,
        remoteQueue: identical(remoteQueue, _keep)
            ? this.remoteQueue
            : remoteQueue as RemoteQueueView?,
      );

  /// Another device is the one playing.
  bool get remoteActive =>
      status == ConnectStatus.online &&
      activeDeviceId != null &&
      activeDeviceId != deviceId;

  DeviceInfo? get activeDevice {
    for (final d in devices) {
      if (d.id == activeDeviceId) return d;
    }
    return null;
  }
}

/// Timings, overridable so tests need not wait in real time.
class ConnectTimings {
  final Duration helloTimeout;
  final Duration silenceTimeout;
  final Duration healthyAfter;
  final Duration reportDebounce;
  final Duration seekDebounce;
  final Duration driftReport;
  final Duration mirrorTick;
  final Duration takeoverGrace;
  final Duration backgroundGrace;
  final double seekJumpSeconds;

  /// While dragging the volume slider the other device hears it at most this often (plus the final value).
  final Duration volumeSendEvery;

  /// After the user moves the volume, state reports about the old value must not move the slider back.
  final Duration volumeHold;

  /// Songs added in quick succession travel as one command.
  final Duration queueAddBatch;

  const ConnectTimings({
    this.helloTimeout = const Duration(seconds: 8),
    this.silenceTimeout = const Duration(seconds: 45),
    this.healthyAfter = const Duration(seconds: 30),
    this.reportDebounce = const Duration(milliseconds: 250),
    this.seekDebounce = const Duration(milliseconds: 150),
    this.driftReport = const Duration(seconds: 10),
    this.mirrorTick = const Duration(milliseconds: 250),
    this.takeoverGrace = const Duration(seconds: 8),
    this.backgroundGrace = const Duration(minutes: 3),
    this.seekJumpSeconds = 1.5,
    this.volumeSendEvery = const Duration(milliseconds: 150),
    this.volumeHold = const Duration(milliseconds: 1500),
    this.queueAddBatch = const Duration(milliseconds: 60),
  });
}

enum _Outcome { ended, silent, unavailable }

class ConnectNotifier extends StateNotifier<ConnectState>
    implements RemoteController {
  final PlayerNotifier _player;
  final DownloadService _downloads;
  final ConnectPrefs _prefs;
  final Future<void> Function() _onRevoked;
  final void Function(String message) _showMessage;
  final ConnectApi Function(Credentials) _apiFactory;
  final SubsonicClient Function(Credentials) _clientFactory;
  final DateTime Function() _now;

  /// Source of the reconnect jitter; injectable so tests get fixed delays.
  final double Function()? _random;
  final ConnectTimings _t;

  ConnectNotifier({
    required PlayerNotifier player,
    required DownloadService downloads,
    required ConnectPrefs prefs,
    required Future<void> Function() onRevoked,
    required void Function(String message) showMessage,
    ConnectApi Function(Credentials)? apiFactory,
    SubsonicClient Function(Credentials)? clientFactory,
    DateTime Function()? now,
    double Function()? random,
    ConnectTimings timings = const ConnectTimings(),
  })  : _player = player,
        _downloads = downloads,
        _prefs = prefs,
        _onRevoked = onRevoked,
        _showMessage = showMessage,
        _apiFactory = apiFactory ?? HttpConnectApi.new,
        _clientFactory = clientFactory ?? SubsonicClient.new,
        _now = now ?? DateTime.now,
        _random = random,
        _t = timings,
        super(const ConnectState());

  // ── Runtime (not part of the observable state) ───────────────────────────────

  Credentials? _creds;
  ConnectApi? _api;
  SubsonicClient? _client;
  bool _running = false;
  CancelToken? _cancel;
  Timer? _sleepTimer;
  Completer<void>? _sleeper;
  int _serverOffsetMs = 0;

  Timer? _reportTimer;
  Timer? _driftTimer;
  Timer? _mirrorTimer;
  Timer? _seekTimer;
  Timer? _volumeTimer;
  double? _pendingVolume;
  DateTime _volumeHoldUntil = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _queueAddTimer;
  List<Song> _pendingAdds = [];
  int _queueWatchers = 0;
  bool _fetchingQueue = false;
  Timer? _suspendTimer;
  StreamSubscription<PlayerState>? _playerSub;
  bool _suspended = false;
  bool _foreground = true;

  /// True while a command from another device is being executed here (it must act locally, never forward).
  bool _executingLocal = false;
  DateTime _takeoverUntil = DateTime.fromMillisecondsSinceEpoch(0);
  String? _lastQueueKey;
  bool _forceQueue = true;

  /// Bumped by every start() and stop(): a connection loop that finds it changed belongs to a previous
  /// session and ends.
  int _generation = 0;

  // Resume where you left off.
  bool _resumeTried = false;
  ({String key, int index, bool playing, DateTime at})? _lastSave;
  final List<String> _seenCommands = [];
  PlayerState _prevPlayer = const PlayerState();
  int _lastLocalMs = 0;
  DateTime _lastLocalAt = DateTime.fromMillisecondsSinceEpoch(0);
  bool _mirrorActive = false;

  /// The queue list the mirror last wrote into the player. While the player still holds exactly that
  /// object, what it shows is another device's track, not something this device is playing — it must
  /// never be reported back as this device's own queue.
  List<Song>? _mirrorQueue;

  int get _serverNowMs => _now().millisecondsSinceEpoch + _serverOffsetMs;

  DeviceIdentity get _identity => DeviceIdentity(
      deviceId: state.deviceId,
      name: state.deviceName,
      type: DeviceType.android);

  // ── RemoteController ─────────────────────────────────────────────────────────

  @override
  bool get isRemote => !_executingLocal && state.remoteActive;

  @override
  void command(CommandType type, {int? positionMs}) {
    if (type == CommandType.seek) {
      // Dragging the slider fires continuously: send only where it comes to rest.
      _seekTimer?.cancel();
      _seekTimer = Timer(_t.seekDebounce,
          () => _sendRemoteCommand(CommandType.seek, positionMs));
      return;
    }
    // Flip play/pause at once so the button answers instantly; the real state follows.
    final before = state.remote;
    PublicState? optimistic;
    if ((type == CommandType.play || type == CommandType.pause) &&
        before != null) {
      optimistic = before.copyWith(
        playing: type == CommandType.play,
        positionMs: positionNowMs(before, _serverNowMs),
        positionAtMs: _serverNowMs,
      );
      state = state.copyWith(remote: optimistic);
      _applyMirror();
    }
    _sendRemoteCommand(type, positionMs).then((delivered) {
      // Not delivered: put the button back — unless the server has told us something newer meanwhile.
      if (!delivered &&
          optimistic != null &&
          identical(state.remote, optimistic)) {
        state = state.copyWith(remote: before);
        _applyMirror();
      }
    });
  }

  @override
  void onLocalStart() {
    if (!isRemote) return;
    // The mirror must not put the other device's track back over the one just started here.
    _takeoverUntil = _now().add(_t.takeoverGrace);
    _player.leaveRemoteMirror(clear: false);
  }

  /// Resolves to whether the command was delivered.
  Future<bool> _sendRemoteCommand(CommandType type, int? positionMs,
      {CommandArgs? args}) async {
    final api = _api;
    if (api == null) return false;
    // Aimed at the device we believe is playing; the server refuses it if another one has taken over.
    final result = await api.sendCommand(state.deviceId, type,
        positionMs: positionMs,
        targetDeviceId: state.activeDeviceId,
        args: args);
    if (result == CommandResult.sent) return true;
    final active = state.activeDevice;
    _showMessage(
      result == CommandResult.targetChanged
          ? 'Another device just took over — try again'
          : result == CommandResult.noActiveDevice ||
                  result == CommandResult.unknownDevice
              ? "${active?.name ?? 'That device'} isn't reachable right now"
              : result == CommandResult.rateLimited
                  ? 'Slow down a little'
                  : "Couldn't reach the server",
    );
    return false;
  }

  // ── Volume and queue of the other device (phase 2) ───────────────────────────

  @override
  double get volume => state.remote?.volume ?? 1.0;

  // The slider follows the finger at once; the other device hears it at a steady pace, then the final value.
  @override
  void setVolume(double volume) {
    final v = volume.clamp(0.0, 1.0);
    final before = state.remote;
    if (before != null) {
      state = state.copyWith(remote: before.copyWith(volume: v));
    }
    _volumeHoldUntil = _now().add(_t.volumeHold);
    _pendingVolume = v;
    if (_volumeTimer == null) _sendVolume();
  }

  void _sendVolume() {
    _volumeTimer = null;
    final v = _pendingVolume;
    if (v == null) return;
    _pendingVolume = null;
    _sendRemoteCommand(CommandType.volume, null, args: CommandArgs(volume: v));
    // Keep the cooldown running so a drag doesn't flood the server; a value that arrives meanwhile goes out at its end.
    _volumeTimer = Timer(_t.volumeSendEvery, _sendVolume);
  }

  ({int real, String songId})? _queueTarget(int index) {
    final view = state.remoteQueue;
    if (view == null || index < 0 || index >= view.songs.length) return null;
    return (real: view.positions[index], songId: view.songs[index].id);
  }

  @override
  void queueRemove(int index) {
    final t = _queueTarget(index);
    final view = state.remoteQueue;
    if (t == null || view == null) return;
    state = state.copyWith(remoteQueue: view.removed(index));
    _sendRemoteCommand(CommandType.queueRemove, null,
        args: CommandArgs(index: t.real, songId: t.songId));
  }

  @override
  void queueMove(int from, int to) {
    final t = _queueTarget(from);
    final dest = _queueTarget(to);
    final view = state.remoteQueue;
    if (t == null || dest == null || view == null) return;
    state = state.copyWith(remoteQueue: view.moved(from, to));
    _sendRemoteCommand(CommandType.queueMove, null,
        args: CommandArgs(index: t.real, to: dest.real, songId: t.songId));
  }

  /// Jump to the song at this index of [ConnectState.remoteQueue] on the playing device.
  void playRemoteQueueItem(int index) {
    final t = _queueTarget(index);
    if (t == null) return;
    _sendRemoteCommand(CommandType.queuePlay, null,
        args: CommandArgs(index: t.real, songId: t.songId));
  }

  // "Add to queue" on this phone means "play next, in the order added", so that is what is sent.
  @override
  void queueAdd(Song song) {
    _pendingAdds.add(song);
    _queueAddTimer ??= Timer(_t.queueAddBatch, _flushQueueAdds);
  }

  static const _queueAddChunk = 100;

  Future<void> _flushQueueAdds() async {
    _queueAddTimer = null;
    final songs = _pendingAdds;
    _pendingAdds = [];
    if (songs.isEmpty) return;
    final name = state.activeDevice?.name ?? 'the other device';
    var delivered = true;
    for (var i = 0; i < songs.length; i += _queueAddChunk) {
      final chunk = songs.skip(i).take(_queueAddChunk).toList();
      final ok = await _sendRemoteCommand(CommandType.queueAdd, null,
          args: CommandArgs(
              mode: QueueAddMode.next,
              songIds: chunk.map((s) => s.id).toList()));
      delivered = ok && delivered;
    }
    if (delivered) {
      _showMessage(songs.length == 1
          ? '1 song will play next on $name'
          : '${songs.length} songs will play next on $name');
    }
  }

  /// Start keeping [ConnectState.remoteQueue] current; returns the function that stops watching.
  void Function() watchRemoteQueue() {
    _queueWatchers++;
    _refreshRemoteQueue();
    var stopped = false;
    return () {
      if (stopped) return;
      stopped = true;
      _queueWatchers = max(0, _queueWatchers - 1);
    };
  }

  /// Keeps the shown queue in step with the playing device, but only while someone watches it (it costs a fetch).
  Future<void> _refreshRemoteQueue({bool retry = true}) async {
    final r = state.remote;
    final api = _api;
    if (api == null ||
        _queueWatchers == 0 ||
        !isRemote ||
        r == null ||
        _fetchingQueue) {
      return;
    }
    if (state.remoteQueue?.version == r.queueVersion) return;
    _fetchingQueue = true;
    var fetched = false;
    try {
      final q = await api.fetchQueue();
      if (q != null && isRemote && mounted) {
        fetched = true;
        final current = state.remote;
        final view = RemoteQueueView(
            version: q.queueVersion,
            songs: q.songs,
            positions: q.positions,
            index: q.index);
        final index = current != null ? view.viewIndexOf(current.index) : -1;
        state = state.copyWith(
            remoteQueue: index >= 0 ? view.copyWith(index: index) : view);
      }
    } catch (_) {
      // keep showing what we have; the next state event tries again
    } finally {
      _fetchingQueue = false;
    }
    // The queue may have changed again while the request was in flight: look once more, but only once and only
    // after a fetch that worked — never a request loop (a failing server, or a view that is already ahead).
    final now = state.remote;
    final have = state.remoteQueue?.version;
    if (retry &&
        fetched &&
        mounted &&
        now != null &&
        have != null &&
        have < now.queueVersion) {
      _refreshRemoteQueue(retry: false);
    }
  }

  /// The current song's place in the shown queue follows the device's state without a refetch.
  void _followRemoteIndex() {
    final view = state.remoteQueue;
    final r = state.remote;
    if (view == null || r == null || view.version != r.queueVersion) return;
    final index = view.viewIndexOf(r.index);
    if (index != view.index) {
      state = state.copyWith(remoteQueue: view.copyWith(index: index));
    }
  }

  // ── Mirror: show the remote device's playback through the normal player state ──

  void _applyMirror() {
    final r = state.remote;
    if (r == null || _now().isBefore(_takeoverUntil)) return;
    if (!_mirrorActive) {
      _mirrorActive = true;
      _player.pauseLocal();
    }
    final durationMs = r.durationMs ?? ((r.song?.duration ?? 0) * 1000);
    _player.applyRemoteMirror(
      song: r.song,
      playing: r.playing,
      position: Duration(milliseconds: positionNowMs(r, _serverNowMs)),
      duration: Duration(milliseconds: durationMs),
      repeat: r.repeat,
      shuffle: r.shuffle,
    );
    _mirrorQueue = _player.state.queue;
  }

  void _startMirror() {
    _applyMirror();
    _mirrorTimer ??= Timer.periodic(_t.mirrorTick, (_) => _applyMirror());
  }

  void _stopMirror() {
    _mirrorTimer?.cancel();
    _mirrorTimer = null;
    _mirrorActive = false;
    if (_player.isMirroring) _player.leaveRemoteMirror();
  }

  void _syncMirror() {
    if (isRemote && state.remote != null) {
      _startMirror();
    } else {
      // This device is the player now (or nobody is): any takeover is settled.
      _takeoverUntil = DateTime.fromMillisecondsSinceEpoch(0);
      _stopMirror();
      if (state.remoteQueue != null) state = state.copyWith(remoteQueue: null);
    }
  }

  // ── Reporting this device's playback ─────────────────────────────────────────

  bool _shouldReport() {
    if (state.status != ConnectStatus.online) return false;
    final p = _player.state;
    if (p.queue.isEmpty) return false;
    if (_player.isMirroring || identical(p.queue, _mirrorQueue)) return false;
    // While another device plays, only a local "play" (taking over) is worth reporting.
    return isRemote ? p.playing : true;
  }

  void _scheduleReport([Duration? delay]) {
    _reportTimer?.cancel();
    _reportTimer = Timer(delay ?? _t.reportDebounce, () => _sendReport());
  }

  Future<void> _sendReport({bool retried = false}) async {
    final api = _api;
    if (api == null || !_shouldReport()) return;
    final p = _player.state;
    final ids = p.queue.map((s) => s.id).toList();
    final key = ids.join(',');
    final withQueue = _forceQueue || key != _lastQueueKey;

    final result = await api.reportState(StateReport(
      deviceId: state.deviceId,
      queueIds: withQueue ? ids : null,
      index: p.currentIndex < 0 ? 0 : p.currentIndex,
      positionMs: p.position.inMilliseconds,
      playing: p.playing,
      repeat: p.repeatMode,
      shuffle: p.shuffle,
      counted: _player.currentPlayCounted,
      volume: _player.volume,
    ));

    switch (result) {
      case ReportResult.ok:
      case ReportResult.okTakeover:
        if (withQueue) {
          _lastQueueKey = key;
          _forceQueue = false;
        }
      case ReportResult.needQueue:
        _forceQueue = true;
        if (!retried) await _sendReport(retried: true);
      case ReportResult.unavailable:
        stop();
        state = state.copyWith(status: ConnectStatus.unavailable);
        return;
      case ReportResult.notActive:
      case ReportResult.unknownDevice:
      case ReportResult.rateLimited:
      case ReportResult.error:
        break; // nothing useful to do
    }
    _saveResume();
  }

  // ── Resume where you left off ────────────────────────────────────────────────

  static const _resumeWindow = 500;
  static const _resumeLookBehind = 50;
  static const _resumeMaxAge = Duration(days: 30);
  // a little under the 10 s drift report, so that report always saves while playing
  static const _saveEvery = Duration(seconds: 9);

  /// The part of the queue worth saving: a window around the current song.
  ({List<String> ids, String key}) _resumeIds() {
    final p = _player.state;
    final start = max(0, p.currentIndex - _resumeLookBehind);
    final ids =
        p.queue.skip(start).take(_resumeWindow).map((s) => s.id).toList();
    return (ids: ids, key: ids.join(','));
  }

  /// Remembers the current queue on the server so any device can pick it up later (only the player saves).
  void _saveResume() {
    final client = _client;
    if (client == null || isRemote || state.status != ConnectStatus.online) {
      return;
    }
    final p = _player.state;
    final song = p.currentSong;
    if (p.queue.isEmpty || song == null) return;
    final (:ids, :key) = _resumeIds();
    final now = _now();
    final last = _lastSave;
    final changed = last == null ||
        last.key != key ||
        last.index != p.currentIndex ||
        last.playing != p.playing;
    if (!changed && !(p.playing && now.difference(last.at) >= _saveEvery)) {
      return;
    }
    _lastSave = (key: key, index: p.currentIndex, playing: p.playing, at: now);
    client
        .savePlayQueue(ids,
            current: song.id, positionMs: p.position.inMilliseconds)
        .catchError((_) {/* best-effort */});
  }

  /// If nobody is playing and this device has nothing loaded, show the last queue again — paused.
  Future<void> _maybeResume() async {
    if (_resumeTried) return;
    _resumeTried = true;
    final client = _client;
    if (client == null) return;
    try {
      final saved = await client.getPlayQueue();
      if (saved == null) return;
      final changed = saved.changed;
      if (changed != null && _now().difference(changed) > _resumeMaxAge) return;
      // Something may have started while the request was in flight.
      if (_player.state.queue.isNotEmpty || state.activeDeviceId != null) {
        return;
      }
      final index =
          max(0, saved.songs.indexWhere((s) => s.id == saved.current));
      await _player.restoreQueue(
        saved.songs,
        index,
        Duration(milliseconds: saved.positionMs),
        play: false,
        counted: false,
        client: client,
        downloads: _downloads,
      );
      // What was just restored is already what the server has: don't write it straight back.
      final key = _resumeIds().key;
      _lastSave = (key: key, index: index, playing: false, at: _now());
    } catch (_) {
      // No saved queue to resume from; nothing else to do.
    }
  }

  void _onPlayerChange(PlayerState s) {
    final prev = _prevPlayer;
    _prevPlayer = s;
    if (_player.isMirroring) return; // that is the mirror writing, not the user
    final now = _now();

    // Starting a track here while another device plays is a takeover in progress.
    if (isRemote &&
        s.currentSong?.id != prev.currentSong?.id &&
        s.queue.isNotEmpty) {
      _takeoverUntil = now.add(_t.takeoverGrace);
    }

    // A jump in the position that time alone doesn't explain is a seek, worth telling the others about.
    final posMs = s.position.inMilliseconds;
    final expected = _lastLocalMs +
        (prev.playing ? now.difference(_lastLocalAt).inMilliseconds : 0);
    final jumped = posMs != prev.position.inMilliseconds &&
        (posMs - expected).abs() > _t.seekJumpSeconds * 1000;
    _lastLocalMs = posMs;
    _lastLocalAt = now;

    final changed = !identical(s.queue, prev.queue) ||
        s.currentIndex != prev.currentIndex ||
        s.playing != prev.playing ||
        s.repeatMode != prev.repeatMode ||
        s.shuffle != prev.shuffle;
    if ((changed || jumped) && _shouldReport()) _scheduleReport();

    // Keeping the connection alive in the background only makes sense while music plays.
    if (s.playing != prev.playing) _updateSuspendTimer();
  }

  // ── Acting on what the server tells us ───────────────────────────────────────

  void _execCommand(CommandInstruction c) {
    if (_seenCommands.contains(c.commandId)) return;
    _seenCommands.add(c.commandId);
    if (_seenCommands.length > 100) _seenCommands.removeAt(0);
    if (c.expiresAtMs < _serverNowMs) return;

    _executingLocal = true;
    try {
      final playing = _player.state.playing;
      switch (c.type) {
        case CommandType.play:
          if (!playing) _player.play();
        case CommandType.pause:
          if (playing) _player.pause();
        case CommandType.next:
          _player.next();
        case CommandType.previous:
          _player.previous();
        case CommandType.seek:
          _player.seek(Duration(milliseconds: c.positionMs ?? 0));
        case CommandType.volume:
          final v = c.volume;
          if (v != null && v.isFinite) {
            _player.setVolume(v);
            _scheduleReport(); // so the other devices show the new volume
          }
        // The queue edits name the song they were aimed at: if the queue changed since the sender looked, the
        // index points at something else now and the edit is dropped rather than applied to the wrong song.
        case CommandType.queuePlay:
          final i = c.index;
          if (i != null && _songAt(i)?.id == c.songId) {
            _player.playFromQueueIndex(i);
          }
        case CommandType.queueRemove:
          final i = c.index;
          // Removing the song that is playing would stop the music; the other device's UI doesn't offer it.
          if (i != null &&
              i != _player.state.currentIndex &&
              _songAt(i)?.id == c.songId) {
            _player.removeFromQueue(i);
          }
        case CommandType.queueMove:
          final i = c.index;
          final to = c.to;
          if (i != null &&
              to != null &&
              to >= 0 &&
              to < _player.state.queue.length &&
              _songAt(i)?.id == c.songId) {
            _player.reorderQueue(i, to);
          }
        case CommandType.queueAdd:
          final client = _client;
          if (client == null) break;
          for (final song in c.songs) {
            switch (c.mode) {
              case QueueAddMode.next:
                _player.addToQueue(song, client, _downloads);
              case QueueAddMode.end:
                _player.addToQueueEnd(song, client, _downloads);
              case null:
                break;
            }
          }
      }
    } finally {
      _executingLocal = false;
    }
  }

  Song? _songAt(int index) {
    final queue = _player.state.queue;
    return index >= 0 && index < queue.length ? queue[index] : null;
  }

  static const _loadRetryFirst = Duration(milliseconds: 500);
  static const _loadRetrySecond = Duration(milliseconds: 1500);

  Future<void> _handleLoad(LoadInstruction load) async {
    final api = _api;
    final client = _client;
    if (api == null || client == null) return;
    try {
      // By now the server already considers this device the active one, so a queue that fails to arrive
      // would strand the handover: try a few times before giving up.
      QueueResult? queue;
      for (var attempt = 0;
          attempt < 3 && (queue == null || queue.songs.isEmpty);
          attempt++) {
        if (attempt > 0) {
          await Future<void>.delayed(
              attempt == 1 ? _loadRetryFirst : _loadRetrySecond);
        }
        queue = await api.fetchQueue();
      }
      if (queue == null || queue.songs.isEmpty) {
        _showMessage("Couldn't load the queue from the other device");
        return;
      }
      final previous = state.remote;
      await _player.applyModes(
          repeat: previous?.repeat ?? LoopMode.off,
          shuffle: previous?.shuffle ?? false);
      // We are the player now: the next local state report carries the whole queue again.
      _forceQueue = true;
      await _player.restoreQueue(
        queue.songs,
        queue.index,
        Duration(milliseconds: load.positionMs),
        play: load.play,
        counted: load.counted,
        client: client,
        downloads: _downloads,
      );
    } catch (_) {
      // A handover that cannot be loaded (network, malformed queue) leaves things as they were.
    }
  }

  /// Entry point for server events — public so tests can drive the notifier without a network.
  void handle(String name, Object? data) {
    switch (name) {
      case 'hello':
        _serverOffsetMs = ((data as Map)['serverTimeMs'] as num).toInt() -
            _now().millisecondsSinceEpoch;
        state = state.copyWith(status: ConnectStatus.online);
        _sendOutput(); // the others should know where this phone's sound goes
      case 'snapshot':
        final s = Snapshot.fromJson(Map<String, dynamic>.from(data! as Map));
        state = state.copyWith(
            devices: s.devices,
            activeDeviceId: s.activeDeviceId,
            remote: s.state);
        _syncMirror();
        _refreshRemoteQueue();
        // (Re)connected: let the server know our queue again (it may have restarted).
        _forceQueue = true;
        if (_shouldReport()) _scheduleReport(Duration.zero);
        if (s.activeDeviceId == null && _player.state.queue.isEmpty) {
          _maybeResume();
        }
      case 'devices':
        final m = Map<String, dynamic>.from(data! as Map);
        state = state.copyWith(
            devices: devicesFromJson(m['devices']),
            activeDeviceId: m['activeDeviceId'] as String?);
        _syncMirror();
        _refreshRemoteQueue();
      case 'state':
        var s = PublicState.fromJson(Map<String, dynamic>.from(data! as Map));
        // The user just moved the volume: a report generated before the device heard about it must not drag the slider back.
        final held = state.remote?.volume;
        if (_now().isBefore(_volumeHoldUntil) && held != null) {
          s = s.copyWith(volume: held);
        }
        state = state.copyWith(remote: s, activeDeviceId: s.activeDeviceId);
        _syncMirror();
        _followRemoteIndex();
        _refreshRemoteQueue();
      case 'command':
        final c = CommandInstruction.tryParse(
            Map<String, dynamic>.from(data! as Map));
        if (c != null) _execCommand(c);
      case 'load':
        _handleLoad(
            LoadInstruction.fromJson(Map<String, dynamic>.from(data! as Map)));
      case 'revoked':
        _onRevoked();
      case 'error':
        // e.g. too_many_devices: stay quiet, the reconnect loop backs off
        state = state.copyWith(status: ConnectStatus.offline);
    }
  }

  // ── Connection loop ──────────────────────────────────────────────────────────

  Future<void> _sleep(Duration d) {
    final completer = Completer<void>();
    _sleeper = completer;
    _sleepTimer = Timer(d, () {
      if (!completer.isCompleted) completer.complete();
    });
    return completer.future;
  }

  void _wake() {
    _sleepTimer?.cancel();
    final s = _sleeper;
    if (s != null && !s.isCompleted) s.complete();
  }

  Future<_Outcome> _runStream(CancelToken cancel) async {
    final api = _api!;
    final open = await api.openStream(_identity, cancel);
    if (open.status == 404) return _Outcome.unavailable;
    if (open.status != 200 || open.text == null) return _Outcome.ended;

    final parser = SseParser();
    var gotHello = false;
    var silent = false;
    var lastData = _now();
    final helloTimer = Timer(_t.helloTimeout, () {
      if (!gotHello) {
        silent = true;
        cancel.cancel();
      }
    });
    final watchdog = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_now().difference(lastData) > _t.silenceTimeout) {
        silent = true;
        cancel.cancel();
      }
    });
    try {
      await for (final text in open.text!) {
        lastData = _now();
        for (final item in parser.push(text)) {
          if (item is! SseEvent) continue;
          if (item.name == 'hello') gotHello = true;
          handle(item.name, item.data);
        }
      }
    } catch (_) {
      // cancelled or the connection dropped: reported through the return value
    } finally {
      helloTimer.cancel();
      watchdog.cancel();
    }
    return silent ? _Outcome.silent : _Outcome.ended;
  }

  Future<_Outcome> _runPoll(CancelToken cancel) async {
    final api = _api!;
    int? since;
    try {
      while (_running && !cancel.isCancelled) {
        final r = await api.pollOnce(_identity, since, cancel);
        if (r.status == 404) return _Outcome.unavailable;
        if (r.status != 200) return _Outcome.ended;
        for (final e in r.events) {
          since = e.seq;
          handle(e.name, e.data);
        }
      }
    } catch (_) {
      // cancelled or the connection dropped
    }
    return _Outcome.ended;
  }

  Future<void> _connectionLoop(int mine) async {
    var attempt = 0;
    var silentStreams = 0;
    while (_running && mine == _generation) {
      final cancel = CancelToken();
      _cancel = cancel;
      if (state.status != ConnectStatus.online) {
        state = state.copyWith(status: ConnectStatus.connecting);
      }
      final startedAt = _now();

      _Outcome outcome;
      try {
        outcome =
            state.polling ? await _runPoll(cancel) : await _runStream(cancel);
      } catch (_) {
        outcome = _Outcome.ended;
      }
      if (!_running || mine != _generation) {
        return; // stopped (and maybe restarted) while we were waiting
      }

      if (outcome == _Outcome.unavailable) {
        // An older server without /connect: hide the feature and stop trying.
        stop();
        state = state.copyWith(status: ConnectStatus.unavailable);
        return;
      }

      if (outcome == _Outcome.silent) {
        // Nothing (not even the heartbeat) came through: something on the path buffers streams.
        silentStreams++;
        if (silentStreams >= 2) state = state.copyWith(polling: true);
      } else {
        silentStreams = 0;
      }

      // A connection that lasted a while was healthy: the next failure starts the backoff over at ~1 s.
      if (_now().difference(startedAt) >= _t.healthyAfter) attempt = 0;
      _stopMirror();
      state = state.copyWith(status: ConnectStatus.offline);
      await _sleep(backoff(attempt, _random));
      attempt++;
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /// Loads (or creates) this device's identity. Safe to call more than once.
  Future<void> init() async {
    if (state.deviceId.isNotEmpty) return;
    var id = await _prefs.deviceId();
    if (id == null || id.isEmpty) {
      id = newDeviceId();
      await _prefs.saveDeviceId(id);
    }
    final name = await _prefs.deviceName() ??
        defaultDeviceName(await _prefs.deviceModel());
    if (mounted) state = state.copyWith(deviceId: id, deviceName: name);
  }

  /// Signed in: connect with these credentials.
  Future<void> start(Credentials credentials) async {
    if (_running) return;
    await init();
    if (!mounted || _running) return;
    _running = true;
    _suspended = false;
    _creds = credentials;
    _api = _apiFactory(credentials);
    _client = _clientFactory(credentials);
    _forceQueue = true;
    _lastQueueKey = null;
    _resumeTried = false;
    _lastSave = null;
    _prevPlayer = _player.state;
    _lastLocalMs = _player.state.position.inMilliseconds;
    _lastLocalAt = _now();
    state = state.copyWith(status: ConnectStatus.connecting, polling: false);

    _player.remote = this;
    _playerSub = _player.stream.listen(_onPlayerChange);
    _driftTimer = Timer.periodic(_t.driftReport, (_) {
      if (state.status == ConnectStatus.online &&
          !isRemote &&
          _player.state.playing) {
        _sendReport();
      }
    });
    _connectionLoop(++_generation);
  }

  /// Signed out (or the feature is unavailable): disconnect and forget everything.
  void stop() {
    _running = false;
    _generation++;
    _suspended = false;
    _cancel?.cancel();
    _cancel = null;
    _wake();
    _reportTimer?.cancel();
    _driftTimer?.cancel();
    _seekTimer?.cancel();
    _volumeTimer?.cancel();
    _queueAddTimer?.cancel();
    _suspendTimer?.cancel();
    _reportTimer = _driftTimer = _seekTimer = _suspendTimer = null;
    _volumeTimer = _queueAddTimer = null;
    _pendingVolume = null;
    _pendingAdds = [];
    _volumeHoldUntil = DateTime.fromMillisecondsSinceEpoch(0);
    _takeoverUntil = DateTime.fromMillisecondsSinceEpoch(0);
    _stopMirror();
    _mirrorQueue = null;
    _playerSub?.cancel();
    _playerSub = null;
    if (identical(_player.remote, this)) _player.remote = null;
    _api = null;
    _client = null;
    if (mounted) {
      state = state.copyWith(
          status: ConnectStatus.idle,
          devices: const [],
          activeDeviceId: null,
          remote: null,
          remoteQueue: null);
    }
  }

  /// The app moved to (or came back from) the background. Connections are only kept alive in the
  /// background while music is playing, so a paused phone doesn't hold a radio awake for nothing.
  void setForeground(bool foreground) {
    _foreground = foreground;
    if (foreground) {
      _suspendTimer?.cancel();
      _suspendTimer = null;
      final creds = _creds;
      if (_suspended && creds != null) {
        _suspended = false;
        start(creds);
      }
    } else {
      _updateSuspendTimer();
    }
  }

  void _updateSuspendTimer() {
    if (!_running) return;
    final keepAlive = _foreground || _player.state.playing;
    if (keepAlive) {
      _suspendTimer?.cancel();
      _suspendTimer = null;
    } else {
      _suspendTimer ??= Timer(_t.backgroundGrace, _suspend);
    }
  }

  void _suspend() {
    final creds = _creds;
    if (creds == null || !_running) return;
    stop();
    _creds = creds;
    _suspended = true;
  }

  Future<void> transferTo(String deviceId) async {
    final api = _api;
    if (api == null) return;
    final result = await api.transfer(state.deviceId, deviceId);
    final message = switch (result) {
      TransferResult.targetOffline => 'That device is offline',
      TransferResult.nothingPlaying =>
        'Nothing has been played yet — start something first',
      TransferResult.rateLimited => 'Slow down a little',
      TransferResult.error => "Couldn't reach the server",
      _ => null,
    };
    if (message != null) _showMessage(message);
  }

  /// "Continue here" / "Play here".
  Future<void> transferHere() => transferTo(state.deviceId);

  String? _output;

  /// Called whenever the phone's audio output changes (speaker ↔ Bluetooth, …).
  void setOutput(String? label) {
    _output = label;
    _sendOutput();
  }

  void _sendOutput() {
    if (state.status != ConnectStatus.online) return;
    final api = _api;
    if (api != null) {
      unawaited(
          api.setOutput(state.deviceId, _output).catchError((_) => false));
    }
  }

  Future<void> renameThisDevice(String name) async {
    final clean = name.trim();
    final capped = clean.length > 40 ? clean.substring(0, 40) : clean;
    if (capped.isEmpty) return;
    state = state.copyWith(deviceName: capped);
    await _prefs.saveDeviceName(capped);
    if (state.status == ConnectStatus.online) {
      await _api?.renameDevice(state.deviceId, capped);
    }
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
