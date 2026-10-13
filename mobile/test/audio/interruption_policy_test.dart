import 'package:audio_session/audio_session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/audio/interruption_policy.dart';

void main() {
  final t0 = DateTime(2026, 10, 13, 12);
  DateTime at(int seconds) => t0.add(Duration(seconds: seconds));

  late InterruptionPolicy policy;
  setUp(() => policy = InterruptionPolicy());

  InterruptionAction begin(AudioInterruptionType type,
          {bool playing = true, int s = 0}) =>
      policy.begin(type, playing: playing, now: at(s));

  group('transient loss', () {
    test('pauses, then resumes when focus comes back', () {
      expect(begin(AudioInterruptionType.pause), InterruptionAction.pause);
      expect(
          policy.end(AudioInterruptionType.pause), InterruptionAction.resume);
    });

    test('does nothing if we were not playing', () {
      expect(begin(AudioInterruptionType.pause, playing: false),
          InterruptionAction.none);
      expect(policy.end(AudioInterruptionType.pause), InterruptionAction.none);
    });

    test('does not resume after the user paused in the meantime', () {
      begin(AudioInterruptionType.pause);
      policy.userAction();
      expect(policy.end(AudioInterruptionType.pause), InterruptionAction.none);
    });

    test('resumes only once', () {
      begin(AudioInterruptionType.pause);
      expect(
          policy.end(AudioInterruptionType.pause), InterruptionAction.resume);
      expect(policy.end(AudioInterruptionType.pause), InterruptionAction.none);
    });
  });

  group('ducking', () {
    test('lowers and restores the volume', () {
      expect(begin(AudioInterruptionType.duck), InterruptionAction.duck);
      expect(policy.end(AudioInterruptionType.duck), InterruptionAction.unduck);
    });

    test('is ignored while not playing', () {
      expect(begin(AudioInterruptionType.duck, playing: false),
          InterruptionAction.none);
      expect(policy.end(AudioInterruptionType.duck), InterruptionAction.none);
    });
  });

  group('permanent loss (another app started playing)', () {
    InterruptionAction poll(int s, {required bool other}) =>
        policy.poll(otherAudioActive: other, now: at(s));

    test('pauses and starts watching; never resumes on an "end" event', () {
      expect(begin(AudioInterruptionType.unknown), InterruptionAction.pause);
      expect(policy.watching, isTrue);
      expect(
          policy.end(AudioInterruptionType.unknown), InterruptionAction.none);
    });

    test('resumes once the other audio has ended', () {
      begin(AudioInterruptionType.unknown);
      expect(poll(2, other: true), InterruptionAction.none);
      expect(poll(20, other: true), InterruptionAction.none);
      expect(poll(22, other: false), InterruptionAction.none); // one quiet poll
      expect(poll(24, other: false), InterruptionAction.resume);
      expect(policy.watching, isFalse);
    });

    test('a short gap between two clips does not resume', () {
      begin(AudioInterruptionType.unknown);
      poll(2, other: true);
      expect(poll(4, other: false), InterruptionAction.none);
      expect(poll(6, other: true), InterruptionAction.none);
      expect(poll(8, other: false), InterruptionAction.none);
    });

    test('stays paused when the other audio runs longer than the window', () {
      begin(AudioInterruptionType.unknown);
      poll(2, other: true);
      expect(poll(121, other: true), InterruptionAction.none);
      expect(policy.watching, isFalse);
      // Even when it finally stops, we do not jump back in.
      expect(poll(300, other: false), InterruptionAction.none);
      expect(poll(302, other: false), InterruptionAction.none);
    });

    test('gives up if no other audio is ever seen', () {
      begin(AudioInterruptionType.unknown);
      expect(poll(2, other: false), InterruptionAction.none);
      expect(poll(16, other: false), InterruptionAction.none);
      expect(policy.watching, isFalse);
      expect(poll(18, other: false), InterruptionAction.none);
    });

    test('does not resume after the user took over', () {
      begin(AudioInterruptionType.unknown);
      poll(2, other: true);
      policy.userAction();
      expect(poll(4, other: false), InterruptionAction.none);
      expect(poll(6, other: false), InterruptionAction.none);
    });

    test('a transient pause that becomes permanent is watched, not resumed',
        () {
      begin(AudioInterruptionType.pause);
      expect(
          begin(AudioInterruptionType.unknown, s: 5), InterruptionAction.none);
      expect(policy.watching, isTrue);
      expect(policy.end(AudioInterruptionType.pause), InterruptionAction.none);
    });

    test('polling when nothing is being watched does nothing', () {
      expect(poll(2, other: false), InterruptionAction.none);
    });
  });
}
