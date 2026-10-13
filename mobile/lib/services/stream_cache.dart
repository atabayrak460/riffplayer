import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// An on-disk cache of songs that were streamed, so replaying one (or losing
/// the connection part-way through a queue) doesn't need the network.
///
/// Separate from downloads: a download is something the user asked to keep and
/// is never removed behind their back; cached songs are evicted
/// least-recently-used first once the cache grows past [maxBytes]. The
/// downloading itself is done by just_audio's `LockCachingAudioSource`, which
/// writes `<name>`, `<name>.part` (while in progress) and `<name>.mime`.
class StreamCache {
  StreamCache(this.directory, {this.maxBytes = 0});

  final Directory directory;

  /// The most the cache may hold; 0 turns it off.
  int maxBytes;

  bool get enabled => maxBytes > 0;

  /// Where [songId]'s cached copy lives (it exists only once fully downloaded).
  File fileFor(String songId, String suffix) =>
      File(p.join(directory.path, '${_safe(songId)}.${_safe(suffix)}'));

  /// The finished cached copy, or null. Counts as a use, so it is the last to
  /// be evicted.
  Future<File?> completeFile(String songId, String suffix) async {
    final file = fileFor(songId, suffix);
    if (!await file.exists()) return null;
    if (await File('${file.path}.part').exists()) return null; // restarted
    try {
      await file.setLastModified(DateTime.now());
    } catch (_) {}
    return file;
  }

  /// Bytes used by everything in the cache, partial downloads included.
  Future<int> usageBytes() async {
    var total = 0;
    for (final entry in await _entries()) {
      total += entry.bytes;
    }
    return total;
  }

  /// Deletes the least recently used songs until the cache fits in [maxBytes].
  /// Songs in [keep] (by id) are never deleted — the ones playing or queued next.
  Future<void> trim({Set<String> keep = const {}}) async {
    if (!directory.existsSync()) return;
    final entries = await _entries();
    var total = entries.fold<int>(0, (sum, e) => sum + e.bytes);
    if (enabled && total <= maxBytes) return;
    final keepKeys = keep.map(_safe).toSet();
    final oldestFirst = entries.where((e) => !keepKeys.contains(e.key)).toList()
      ..sort((a, b) => a.used.compareTo(b.used));
    for (final entry in oldestFirst) {
      if (enabled && total <= maxBytes) break;
      for (final f in entry.files) {
        try {
          await f.delete();
        } catch (_) {}
      }
      total -= entry.bytes;
    }
  }

  /// Removes every cached song.
  Future<void> clear() async {
    for (final entry in await _entries()) {
      for (final f in entry.files) {
        try {
          await f.delete();
        } catch (_) {}
      }
    }
  }

  // One entry per song: its file plus the .part/.mime siblings.
  Future<List<_Entry>> _entries() async {
    if (!directory.existsSync()) return const [];
    final byKey = <String, _Entry>{};
    await for (final e in directory.list()) {
      if (e is! File) continue;
      final name = p.basename(e.path);
      final dot = name.indexOf('.');
      final key = dot < 0 ? name : name.substring(0, dot);
      final stat = await e.stat();
      (byKey[key] ??= _Entry(key)).add(e, stat);
    }
    return byKey.values.toList();
  }

  static String _safe(String v) => v.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
}

class _Entry {
  _Entry(this.key);
  final String key;
  final files = <File>[];
  int bytes = 0;
  DateTime used = DateTime.fromMillisecondsSinceEpoch(0);

  void add(File f, FileStat stat) {
    files.add(f);
    bytes += stat.size;
    if (stat.modified.isAfter(used)) used = stat.modified;
  }
}

const _limitKey = 'stream_cache_limit_mb';

/// The limits offered in Settings, in MB (0 = off).
const streamCacheLimitsMb = [0, 256, 512, 1024, 2048, 5120];

/// The cache in the app's cache directory (which Android may also clear when
/// storage runs low), with the limit the user chose. Off until they choose one.
Future<StreamCache> loadStreamCache() async {
  final prefs = await SharedPreferences.getInstance();
  final dir =
      Directory(p.join((await getTemporaryDirectory()).path, 'stream_cache'));
  return StreamCache(dir,
      maxBytes: (prefs.getInt(_limitKey) ?? 0) * 1024 * 1024);
}

/// Changes and saves the cache limit (MB, 0 = off); shrinking it frees space
/// at once.
Future<void> setStreamCacheLimitMb(StreamCache cache, int mb) async {
  cache.maxBytes = mb * 1024 * 1024;
  final prefs = await SharedPreferences.getInstance();
  await prefs.setInt(_limitKey, mb);
  if (mb == 0) {
    await cache.clear();
  } else {
    await cache.trim();
  }
}
