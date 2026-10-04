// The queue of the *other* device as this device shows it (RiffPlayer Connect, docs/CONNECT-DESIGN.md §16).
// Plain Dart: the view the connect notifier keeps, and the optimistic edits applied to it while the real
// edit travels to the playing device. The counterpart of web/src/lib/remoteQueue.ts.

import '../api/types.dart';

class RemoteQueueView {
  /// The queue version this view was fetched at; a newer one in the device's state means "refetch".
  final int version;
  final List<Song> songs;

  /// Real queue position of each song — ids the library no longer knows are missing from [songs].
  final List<int> positions;

  /// Index into [songs] of the song being played, or -1.
  final int index;

  const RemoteQueueView({
    required this.version,
    required this.songs,
    required this.positions,
    required this.index,
  });

  RemoteQueueView copyWith(
          {List<Song>? songs, List<int>? positions, int? index}) =>
      RemoteQueueView(
        version: version,
        songs: songs ?? this.songs,
        positions: positions ?? this.positions,
        index: index ?? this.index,
      );

  /// Index into [songs] for a real queue position (the device's `state.index`), or -1 if it isn't shown.
  int viewIndexOf(int realIndex) => positions.indexOf(realIndex);

  /// The view after moving the song at [from] to [to] (same semantics as a local reorder; the current
  /// song follows). `positions` are slots in the real queue, not properties of a song: they stay put.
  RemoteQueueView moved(int from, int to) {
    if (from == to ||
        from < 0 ||
        to < 0 ||
        from >= songs.length ||
        to >= songs.length) {
      return this;
    }
    final next = [...songs];
    final song = next.removeAt(from);
    next.insert(to, song);
    var i = index;
    if (from == i) {
      i = to;
    } else if (from < i && to >= i) {
      i--;
    } else if (from > i && to <= i) {
      i++;
    }
    return copyWith(songs: next, index: i);
  }

  /// The view after removing the song at [at]; later songs move up one real position.
  RemoteQueueView removed(int at) {
    if (at < 0 || at >= songs.length) return this;
    final nextSongs = [...songs]..removeAt(at);
    final nextPositions = <int>[];
    for (var i = 0; i < positions.length; i++) {
      if (i == at) continue;
      nextPositions.add(i > at ? positions[i] - 1 : positions[i]);
    }
    var i = index;
    if (at < i) {
      i--;
    } else if (at == i) {
      i = -1;
    }
    return copyWith(songs: nextSongs, positions: nextPositions, index: i);
  }
}
