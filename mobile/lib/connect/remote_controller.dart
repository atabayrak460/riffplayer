import '../api/types.dart';
import 'connect_models.dart';

/// Hook that lets RiffPlayer Connect turn the player's transport actions into remote commands while
/// another device is the one playing (the Dart counterpart of `remote` in web/src/store/player.ts).
/// A tiny interface in its own file so the player doesn't depend on the connect notifier.
abstract class RemoteController {
  /// Another device is playing and this one is only a remote.
  bool get isRemote;

  void command(CommandType type, {int? positionMs});

  /// The user started something on this device (a takeover is on its way).
  void onLocalStart();

  /// Phase 2: the other device's volume and queue. Queue indexes are positions in the queue as this device
  /// shows it (see the connect notifier's `remoteQueue`).
  void setVolume(double volume);

  /// The other device's volume (1.0 if it hasn't said).
  double get volume;
  void queueAdd(Song song);
  void queueRemove(int index);
  void queueMove(int from, int to);
}
