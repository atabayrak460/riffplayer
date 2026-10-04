import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/providers.dart';
import '../services/audio_output.dart';
import 'connect_notifier.dart';
import 'connect_prefs.dart';

/// Lets the notifier (which has no BuildContext) show a SnackBar; wired to `MaterialApp.scaffoldMessengerKey`.
final rootMessengerKey = GlobalKey<ScaffoldMessengerState>();

void _showRootMessage(String message) {
  rootMessengerKey.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 2)));
}

/// RiffPlayer Connect for this device. Started/stopped with the session from `app.dart`.
final connectProvider =
    StateNotifierProvider<ConnectNotifier, ConnectState>((ref) {
  final notifier = ConnectNotifier(
    player: ref.read(playerProvider.notifier),
    downloads: ref.read(downloadServiceProvider),
    prefs: SharedPrefsConnectPrefs(),
    onRevoked: () => ref.read(authProvider.notifier).logout(),
    showMessage: _showRootMessage,
  );
  // Tell the other devices where this phone's sound goes (Bluetooth speaker, headphones, …).
  ref.listen<AudioOutput>(
      audioOutputProvider, (_, o) => notifier.setOutput(o.label),
      fireImmediately: true);
  // A failed read of the stored identity just leaves the id empty until the next start() retries it.
  notifier.init().catchError((_) {});
  return notifier;
});
