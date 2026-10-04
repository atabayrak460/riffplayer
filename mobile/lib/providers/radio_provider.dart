import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/types.dart';
import 'providers.dart';

/// What a radio was started from. [name] is shown in the UI ("Radio · Karma Police").
class RadioSeed {
  const RadioSeed(this.type, this.id, this.name);
  final String type; // song / artist / album / playlist
  final String id;
  final String name;
}

const _batch = 30;
const _refillWhenLeft = 5;
const _maxExclude = 300;

/// "Radio": an endless queue seeded by a song, artist, album or playlist. The
/// server picks the songs; this keeps the queue topped up while it plays and
/// switches itself off as soon as the user plays something that did not come
/// from the radio. Twin of `web/src/store/radio.ts`.
class RadioNotifier extends StateNotifier<RadioSeed?> {
  RadioNotifier(this._ref) : super(null) {
    _ref.listen<PlayerState>(playerProvider, (_, s) => _onPlayerChanged(s));
  }

  final Ref _ref;
  final Set<String> _ids = {};
  bool _refilling = false;

  /// Starts a radio. Returns null on success, or a message to show the user.
  Future<String?> start(RadioSeed seed, {Song? firstSong}) async {
    final client = _ref.read(apiClientProvider);
    if (client == null) return 'Not signed in.';
    try {
      final batch = await client.getRadio(seed.type, seed.id,
          count: _batch, exclude: [if (firstSong != null) firstSong.id]);
      final songs = [
        if (firstSong != null) firstSong,
        ...batch.where((s) => s.id != firstSong?.id),
      ];
      if (songs.isEmpty) {
        return 'There isn\'t enough music in your library to build a radio from this.';
      }
      _ids
        ..clear()
        ..addAll(songs.map((s) => s.id));
      await _ref.read(playerProvider.notifier).playSong(
            songs.first,
            client,
            _ref.read(downloadServiceProvider),
            queue: songs,
            queueIndex: 0,
          );
      state = seed;
      return null;
    } catch (e) {
      return 'Couldn\'t start the radio.';
    }
  }

  void stop() {
    _ids.clear();
    state = null;
  }

  void _onPlayerChanged(PlayerState s) {
    final seed = state;
    if (seed == null) return;
    final current = s.currentSong;
    if (s.queue.isEmpty || (current != null && !_ids.contains(current.id))) {
      stop();
      return;
    }
    if (s.queue.length - s.currentIndex - 1 <= _refillWhenLeft) _refill(seed);
  }

  Future<void> _refill(RadioSeed seed) async {
    if (_refilling) return;
    final client = _ref.read(apiClientProvider);
    if (client == null) return;
    _refilling = true;
    try {
      final queue = _ref.read(playerProvider).queue;
      final exclude = [
        for (final s in queue
            .skip(queue.length > _maxExclude ? queue.length - _maxExclude : 0))
          s.id,
      ];
      final batch = await client.getRadio(seed.type, seed.id,
          count: _batch, exclude: exclude);
      // The radio may have been stopped while this was loading.
      if (!identical(state, seed)) return;
      final downloads = _ref.read(downloadServiceProvider);
      for (final song in batch) {
        _ids.add(song.id);
        await _ref
            .read(playerProvider.notifier)
            .addToQueueEnd(song, client, downloads);
      }
    } catch (_) {
      // Offline or a hiccup: the queue just plays out; the next track change tries again.
    } finally {
      _refilling = false;
    }
  }
}

final radioProvider = StateNotifierProvider<RadioNotifier, RadioSeed?>(
    (ref) => RadioNotifier(ref));
