import 'package:audio_session/audio_session.dart';

/// What the player should do in response to an audio-focus event.
enum InterruptionAction { none, pause, resume, duck, unduck }

/// Decides how playback reacts when another app takes audio focus.
///
/// * A transient loss (a call, a notification sound, a short video that asks
///   for transient focus) pauses and resumes when focus comes back.
/// * A "may duck" loss lowers the volume and restores it afterwards.
/// * A permanent loss (`unknown`; another app simply started playing) never
///   gets a "focus is back" event. If we were playing we pause, then watch
///   whether the other app's audio ends soon (a Twitter/X video, say): if it
///   does within [permanentWindow] we resume; if it runs longer, or something
///   else is clearly in charge (another music app), we stay paused.
///
/// Pure logic with an injectable clock, so it is testable without a device.
class InterruptionPolicy {
  InterruptionPolicy({
    this.permanentWindow = const Duration(minutes: 2),
    this.startGrace = const Duration(seconds: 15),
    this.quietPollsToResume = 2,
  });

  /// After a permanent loss, resume only if the other audio ended within this.
  final Duration permanentWindow;

  /// How long to wait for the other app's audio to be seen at all before
  /// giving up (the loss was not caused by playback we can watch).
  final Duration startGrace;

  /// Consecutive "nothing else is playing" polls required before resuming, so
  /// a gap between two clips doesn't count as the end.
  final int quietPollsToResume;

  bool _pausedByUs = false;
  bool _permanent = false;
  bool _ducked = false;
  bool _sawOtherAudio = false;
  int _quietPolls = 0;
  DateTime? _since;

  /// True while we paused for a permanent loss and are watching for the end of
  /// the other audio — the handler polls only then.
  bool get watching => _pausedByUs && _permanent;

  InterruptionAction begin(
    AudioInterruptionType type, {
    required bool playing,
    required DateTime now,
  }) {
    switch (type) {
      case AudioInterruptionType.duck:
        if (!playing || _pausedByUs) return InterruptionAction.none;
        _ducked = true;
        return InterruptionAction.duck;
      case AudioInterruptionType.pause:
      case AudioInterruptionType.unknown:
        final permanent = type == AudioInterruptionType.unknown;
        if (_pausedByUs) {
          // A transient pause that turns into a permanent loss.
          if (permanent && !_permanent) _startWatching(now);
          return InterruptionAction.none;
        }
        if (!playing) return InterruptionAction.none;
        _pausedByUs = true;
        _permanent = false;
        if (permanent) _startWatching(now);
        return InterruptionAction.pause;
    }
  }

  InterruptionAction end(AudioInterruptionType type) {
    switch (type) {
      case AudioInterruptionType.duck:
        if (!_ducked) return InterruptionAction.none;
        _ducked = false;
        return InterruptionAction.unduck;
      case AudioInterruptionType.pause:
        if (_pausedByUs && !_permanent) {
          _reset();
          return InterruptionAction.resume;
        }
        return InterruptionAction.none;
      case AudioInterruptionType.unknown:
        return InterruptionAction.none;
    }
  }

  /// One look at whether any other app is playing audio ([otherAudioActive]).
  InterruptionAction poll({
    required bool otherAudioActive,
    required DateTime now,
  }) {
    if (!watching) return InterruptionAction.none;
    final elapsed = now.difference(_since!);
    if (elapsed > permanentWindow) {
      _reset();
      return InterruptionAction.none;
    }
    if (otherAudioActive) {
      _sawOtherAudio = true;
      _quietPolls = 0;
      return InterruptionAction.none;
    }
    if (!_sawOtherAudio) {
      if (elapsed > startGrace) _reset();
      return InterruptionAction.none;
    }
    if (++_quietPolls >= quietPollsToResume) {
      _reset();
      return InterruptionAction.resume;
    }
    return InterruptionAction.none;
  }

  /// The user pressed play/pause/stop themselves: whatever we were waiting to
  /// resume is no longer wanted.
  void userAction() => _reset();

  void _startWatching(DateTime now) {
    _permanent = true;
    _since = now;
    _sawOtherAudio = false;
    _quietPolls = 0;
  }

  void _reset() {
    _pausedByUs = false;
    _permanent = false;
    _sawOtherAudio = false;
    _quietPolls = 0;
    _since = null;
  }
}
