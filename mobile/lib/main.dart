import 'dart:async';
import 'package:audio_service/audio_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'audio/audio_handler.dart';
import 'app.dart';
import 'providers/providers.dart';
import 'app_colors.dart';
import 'providers/equalizer_provider.dart';
import 'providers/playback_settings_provider.dart';
import 'providers/theme_provider.dart';
import 'theme.dart';
import 'tv/tv_detection.dart';

void main() {
  // Catches anything FlutterError.onError doesn't (async errors outside a
  // widget build, e.g. an unawaited Future rejecting) so the app logs and
  // keeps running instead of silently no-op'ing or handing the platform a
  // raw crash. No external crash reporting per CLAUDE.md's privacy-first
  // stance — this only ever logs locally.
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();

    // Theme first, before any frame: the stored mode decides the palette, and
    // the Android system bars are styled to match it (see applySystemChrome).
    final themeMode = await loadThemeMode();
    final skin = await loadSkin();
    AppColors.current = resolvePalette(themeMode, skin,
        WidgetsBinding.instance.platformDispatcher.platformBrightness);
    applySystemChrome(AppColors.current);

    FlutterError.onError = (FlutterErrorDetails details) {
      FlutterError.presentError(details);
      debugPrint('[FlutterError] ${details.exceptionAsString()}');
    };

    // Initialise the audio handler — this registers the background service
    // on Android and enables background audio on iOS.
    final audioHandler = await AudioService.init(
      builder: RiffPlayerAudioHandler.new,
      config: const AudioServiceConfig(
        androidNotificationChannelId: 'com.riffplayer.audio',
        androidNotificationChannelName: 'RiffPlayer',
        androidNotificationIcon: 'drawable/ic_stat_riff',
        androidNotificationOngoing: true,
        androidStopForegroundOnPause: true,
        notificationColor: Color(0xFFF5A524),
      ),
    );

    final playback = await loadPlaybackSettings();
    audioHandler.setReplayGain(playback.replayGain, playback.preampDb);

    final equalizer = await loadEqualizerState();
    final isTv = await detectAndroidTv();

    runApp(
      ProviderScope(
        overrides: [
          audioHandlerProvider.overrideWithValue(audioHandler),
          isTvProvider.overrideWithValue(isTv),
          themeModeProvider.overrideWith((ref) => ThemeModeNotifier(themeMode)),
          skinProvider.overrideWith((ref) => SkinNotifier(skin)),
          playbackSettingsProvider.overrideWith(
              (ref) => PlaybackSettingsNotifier(audioHandler, playback)),
          equalizerProvider.overrideWith((ref) =>
              EqualizerNotifier(audioHandler.equalizerBackend, equalizer)),
        ],
        child: const RiffPlayerApp(),
      ),
    );
  }, (error, stack) {
    debugPrint('[UncaughtError] $error\n$stack');
  });
}
