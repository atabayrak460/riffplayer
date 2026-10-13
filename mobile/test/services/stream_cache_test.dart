import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:riffplayer_mobile/services/stream_cache.dart';

void main() {
  late Directory dir;
  late StreamCache cache;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('stream_cache_test_');
    cache = StreamCache(dir, maxBytes: 100);
  });

  tearDown(() {
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  });

  // A cached song of [bytes] bytes last used [minutesAgo] minutes ago.
  File song(String id, int bytes, {int minutesAgo = 0, String suffix = 'mp3'}) {
    final f = cache.fileFor(id, suffix)
      ..writeAsBytesSync(List.filled(bytes, 1));
    f.setLastModifiedSync(
        DateTime.now().subtract(Duration(minutes: minutesAgo)));
    return f;
  }

  bool has(String id) => cache.fileFor(id, 'mp3').existsSync();

  test('is off at a limit of 0', () {
    expect(StreamCache(dir).enabled, isFalse);
    expect(cache.enabled, isTrue);
  });

  test('file names are safe whatever the id looks like', () {
    final f = cache.fileFor('../evil/id', 'm p3');
    expect(p.dirname(f.path), dir.path);
  });

  group('completeFile', () {
    test('is null for a song that was never cached', () async {
      expect(await cache.completeFile('x', 'mp3'), isNull);
    });

    test('returns a finished download', () async {
      final f = song('a', 10);
      expect((await cache.completeFile('a', 'mp3'))!.path, f.path);
    });

    test('is null while a partial download is still there', () async {
      song('a', 10);
      File('${cache.fileFor('a', 'mp3').path}.part').writeAsBytesSync([1]);
      expect(await cache.completeFile('a', 'mp3'), isNull);
    });

    test('counts as a use, so it outlives songs that were not played',
        () async {
      song('old', 60, minutesAgo: 30);
      song('other', 60, minutesAgo: 20);

      await cache.completeFile('old', 'mp3'); // played again just now
      await cache.trim();

      expect(has('old'), isTrue);
      expect(has('other'), isFalse);
    });
  });

  group('trim', () {
    test('does nothing while the cache fits', () async {
      song('a', 40);
      song('b', 40);
      await cache.trim();
      expect([has('a'), has('b')], [true, true]);
    });

    test('removes the least recently used songs first, only as many as needed',
        () async {
      song('a', 40, minutesAgo: 30);
      song('b', 40, minutesAgo: 20);
      song('c', 40, minutesAgo: 10);

      await cache.trim();

      expect([has('a'), has('b'), has('c')], [false, true, true]);
    });

    test('never removes the songs it is told to keep', () async {
      song('a', 60, minutesAgo: 30);
      song('b', 60, minutesAgo: 10);

      await cache.trim(keep: {'a'});

      expect([has('a'), has('b')], [true, false]);
    });

    test('takes the .part and .mime files of a song with it', () async {
      final a = song('a', 60, minutesAgo: 30);
      for (final ext in ['part', 'mime']) {
        File('${a.path}.$ext')
          ..writeAsBytesSync(List.filled(10, 1))
          ..setLastModifiedSync(
              DateTime.now().subtract(const Duration(minutes: 30)));
      }
      song('b', 60, minutesAgo: 1);

      await cache.trim();

      expect(dir.listSync().map((e) => p.basename(e.path)).toList(), ['b.mp3']);
    });

    test('counts partial downloads towards the size', () async {
      final a = song('a', 30, minutesAgo: 30);
      File('${a.path}.part').writeAsBytesSync(List.filled(80, 1));
      expect(await cache.usageBytes(), 110);

      await cache.trim();

      expect(has('a'), isFalse);
    });

    test('with the cache off, removes everything that is not kept', () async {
      song('a', 10);
      song('b', 10);
      cache.maxBytes = 0;

      await cache.trim(keep: {'b'});

      expect([has('a'), has('b')], [false, true]);
    });

    test('is fine when the directory does not exist yet', () async {
      dir.deleteSync(recursive: true);
      await cache.trim();
      expect(await cache.usageBytes(), 0);
    });
  });

  test('clear removes every song', () async {
    song('a', 10);
    song('b', 10);
    await cache.clear();
    expect(await cache.usageBytes(), 0);
  });
}
