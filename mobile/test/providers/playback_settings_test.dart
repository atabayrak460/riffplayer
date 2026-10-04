import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/audio/replay_gain.dart';
import 'package:riffplayer_mobile/providers/playback_settings_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../helpers/mocks.dart';

void main() {
  late MockAudioHandler handler;

  setUpAll(() => registerFallbackValue(ReplayGainMode.track));

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    handler = MockAudioHandler();
  });

  test('defaults to per-track levelling with no pre-amp', () async {
    final s = await loadPlaybackSettings();
    expect(s.replayGain, ReplayGainMode.track);
    expect(s.preampDb, 0);
  });

  test('a changed mode is applied to the player at once and stored', () async {
    final notifier = PlaybackSettingsNotifier(handler);
    await notifier.setReplayGain(ReplayGainMode.album);

    verify(() => handler.setReplayGain(ReplayGainMode.album, 0)).called(1);
    expect((await loadPlaybackSettings()).replayGain, ReplayGainMode.album);
  });

  test('the pre-amp keeps the mode, rounds to half dB and stays within ±12',
      () async {
    final notifier = PlaybackSettingsNotifier(handler);
    await notifier.setReplayGain(ReplayGainMode.album);

    await notifier.setPreampDb(2.74);
    expect(notifier.state.preampDb, 2.5);
    verify(() => handler.setReplayGain(ReplayGainMode.album, 2.5)).called(1);

    await notifier.setPreampDb(40);
    expect(notifier.state.preampDb, 12);
    await notifier.setPreampDb(-40);
    expect(notifier.state.preampDb, -12);
    expect((await loadPlaybackSettings()).preampDb, -12);
  });

  test('an unknown stored mode falls back to per-track', () async {
    SharedPreferences.setMockInitialValues({'replay_gain_mode': 'loud'});
    expect((await loadPlaybackSettings()).replayGain, ReplayGainMode.track);
  });
}
