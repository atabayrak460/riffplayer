import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/connect/remote_queue.dart';

Song song(String id) => Song(
      id: id,
      title: id,
      artist: 'A',
      artistId: 'ar',
      album: 'B',
      albumId: 'al',
      suffix: 'mp3',
    );

RemoteQueueView view(List<String> ids, int index, [List<int>? positions]) =>
    RemoteQueueView(
      version: 1,
      songs: ids.map(song).toList(),
      positions: positions ?? List.generate(ids.length, (i) => i),
      index: index,
    );

List<String> ids(RemoteQueueView v) => v.songs.map((s) => s.id).toList();

void main() {
  group('viewIndexOf', () {
    test('maps a real queue position to the shown index', () {
      final v = view(['a', 'c', 'd'], 0, [0, 2, 3]);
      expect(v.viewIndexOf(2), 1);
      expect(v.viewIndexOf(1), -1); // that id is not in the library any more
    });
  });

  group('moved', () {
    test('moves a song and keeps the current one pointing at the same song',
        () {
      final v = view(['a', 'b', 'c', 'd', 'e'], 2).moved(0, 3);
      expect(ids(v), ['b', 'c', 'd', 'a', 'e']);
      expect(v.index, 1);
      expect(v.songs[v.index].id, 'c');
    });

    test('follows the current song when it is the one that moves', () {
      final v = view(['a', 'b', 'c', 'd'], 1).moved(1, 3);
      expect(ids(v), ['a', 'c', 'd', 'b']);
      expect(v.index, 3);
    });

    test('shifts the current song down when something jumps in front of it',
        () {
      final v = view(['a', 'b', 'c', 'd'], 1).moved(3, 0);
      expect(ids(v), ['d', 'a', 'b', 'c']);
      expect(v.songs[v.index].id, 'b');
    });

    test('leaves the real positions alone and ignores no-ops and bad indexes',
        () {
      final base = view(['a', 'b', 'c'], 0, [0, 2, 5]);
      expect(base.moved(0, 2).positions, [0, 2, 5]);
      expect(identical(base.moved(1, 1), base), isTrue);
      expect(identical(base.moved(0, 9), base), isTrue);
      expect(identical(base.moved(-1, 0), base), isTrue);
    });
  });

  group('removed', () {
    test('removes a song and moves the later real positions up', () {
      final v = view(['a', 'b', 'c', 'd'], 3).removed(1);
      expect(ids(v), ['a', 'c', 'd']);
      expect(v.positions, [0, 1, 2]);
      expect(v.index, 2);
      expect(v.songs[v.index].id, 'd');
    });

    test(
        'keeps the index when the removed song is after the current one, clears it when it is the current one',
        () {
      expect(view(['a', 'b', 'c'], 0).removed(2).index, 0);
      expect(view(['a', 'b', 'c'], 1).removed(1).index, -1);
    });

    test('respects gaps left by unknown ids', () {
      expect(view(['a', 'b', 'c'], 2, [0, 2, 4]).removed(1).positions, [0, 3]);
    });

    test('ignores an out-of-range index', () {
      final base = view(['a'], 0);
      expect(identical(base.removed(5), base), isTrue);
    });
  });
}
