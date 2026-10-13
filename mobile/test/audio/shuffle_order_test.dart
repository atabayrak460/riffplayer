import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/audio/shuffle_order.dart';

void main() {
  bool isPermutation(List<int> p, int n) =>
      p.length == n &&
      (List.of(p)..sort()).toString() ==
          [for (var i = 0; i < n; i++) i].toString();

  group('shuffleFirst', () {
    test('puts the tapped song first and keeps every song exactly once', () {
      for (var seed = 0; seed < 20; seed++) {
        final p = shuffleFirst(30, 7, Random(seed));
        expect(p.first, 7);
        expect(isPermutation(p, 30), isTrue);
      }
    });

    test('is a different order each time', () {
      final orders = {
        for (var seed = 0; seed < 10; seed++)
          shuffleFirst(30, 0, Random(seed)).toString(),
      };
      expect(orders.length, greaterThan(1));
    });

    test('handles an empty and a one-song queue', () {
      expect(shuffleFirst(0, 0, Random(1)), isEmpty);
      expect(shuffleFirst(1, 0, Random(1)), [0]);
    });
  });

  group('shuffleUpcoming', () {
    test('leaves the current song and everything before it where they are', () {
      final p = shuffleUpcoming(20, 5, Random(3));
      expect(p.sublist(0, 6), [0, 1, 2, 3, 4, 5]);
      expect(isPermutation(p, 20), isTrue);
    });

    test('actually shuffles what comes after', () {
      final p = shuffleUpcoming(50, 0, Random(3));
      expect(p.sublist(1), isNot([for (var i = 1; i < 50; i++) i]));
    });

    test('a different seed gives a different order (no fixed order)', () {
      expect(shuffleUpcoming(50, 0, Random(1)),
          isNot(shuffleUpcoming(50, 0, Random(2))));
    });

    test('is a no-op at the last song', () {
      expect(shuffleUpcoming(4, 3, Random(1)), [0, 1, 2, 3]);
    });
  });

  group('restoreUpcoming', () {
    // Tags are compared by identity, like the real MediaItems.
    final a = Object(), b = Object(), c = Object(), d = Object(), e = Object();

    test('puts the upcoming songs back in their original order', () {
      final original = [a, b, c, d, e];
      // Shuffled while playing a: queue is now a, d, b, e, c.
      final p = restoreUpcoming([a, d, b, e, c], 0, original);
      expect(p, [0, 2, 4, 1, 3]); // a, b, c, d, e
    });

    test('keeps what was already played in place', () {
      final original = [a, b, c, d, e];
      // Current is the 2nd entry; the first one stays first.
      final p = restoreUpcoming([a, b, e, c, d], 1, original);
      expect([
        for (final i in p) [a, b, e, c, d][i]
      ], [
        a,
        b,
        c,
        d,
        e
      ]);
    });

    test('a song the original order does not know stays after the known ones',
        () {
      final extra = Object();
      final p = restoreUpcoming([a, extra, c, b], 0, [a, b, c]);
      expect([
        for (final i in p) [a, extra, c, b][i]
      ], [
        a,
        b,
        c,
        extra
      ]);
    });
  });

  test('isIdentity / applyPermutation', () {
    expect(isIdentity([0, 1, 2]), isTrue);
    expect(isIdentity([1, 0, 2]), isFalse);
    expect(applyPermutation(['x', 'y', 'z'], [2, 0, 1]), ['z', 'x', 'y']);
  });
}
