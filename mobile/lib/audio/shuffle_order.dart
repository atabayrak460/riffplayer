import 'dart:math';

/// Queue shuffling, done on plain index permutations so it can be tested
/// without a player. A permutation `perm` means: the new queue's item `i` is
/// the old queue's item `perm[i]`.
///
/// The player doesn't use just_audio's own shuffle mode: its order is fixed
/// when a queue is loaded, it puts songs added later at random positions and
/// it isn't visible to the queue screen. Here the queue itself is reordered,
/// so what the queue shows is what plays.

/// A fresh queue with shuffle on: [first] (the song that was tapped) leads and
/// everything else follows in random order.
List<int> shuffleFirst(int length, int first, Random random) {
  final rest = [
    for (var i = 0; i < length; i++)
      if (i != first) i,
  ]..shuffle(random);
  return [if (length > 0) first, ...rest];
}

/// Shuffle switched on mid-queue: songs up to and including [current] stay
/// where they are (so Previous still goes back to what actually played) and
/// the upcoming ones are shuffled.
List<int> shuffleUpcoming(int length, int current, Random random) {
  final head = [for (var i = 0; i <= current && i < length; i++) i];
  final upcoming = [for (var i = current + 1; i < length; i++) i]
    ..shuffle(random);
  return [...head, ...upcoming];
}

/// Shuffle switched off: the upcoming songs go back to the order they had in
/// [original] (the queue as it was before shuffling). [tags] identifies each
/// entry of the current queue, by identity, and [original] lists the same
/// identities in their original order. Entries [original] doesn't know about
/// keep their current relative order after the known ones.
List<int> restoreUpcoming(
    List<Object?> tags, int current, List<Object?> original) {
  final rank = Map<Object?, int>.identity();
  for (var i = 0; i < original.length; i++) {
    rank[original[i]] = i;
  }
  final head = [for (var i = 0; i <= current && i < tags.length; i++) i];
  final upcoming = [for (var i = current + 1; i < tags.length; i++) i];
  final order = {
    for (final i in upcoming) i: rank[tags[i]] ?? original.length + i,
  };
  upcoming.sort((a, b) => order[a]!.compareTo(order[b]!));
  return [...head, ...upcoming];
}

bool isIdentity(List<int> perm) {
  for (var i = 0; i < perm.length; i++) {
    if (perm[i] != i) return false;
  }
  return true;
}

List<T> applyPermutation<T>(List<T> items, List<int> perm) =>
    [for (final i in perm) items[i]];
