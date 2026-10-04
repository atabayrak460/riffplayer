import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/types.dart';
import '../connect/connect_provider.dart';
import '../providers/providers.dart';
import '../widgets/song_tile.dart';

const _eyebrowStyle = TextStyle(
  color: Color(0xFF71717A),
  fontSize: 11,
  fontWeight: FontWeight.w700,
  letterSpacing: 1.2,
);

class QueueScreen extends ConsumerStatefulWidget {
  const QueueScreen({super.key});

  @override
  ConsumerState<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends ConsumerState<QueueScreen> {
  void Function()? _unwatch;

  @override
  void initState() {
    super.initState();
    // While another device is the one playing this screen shows (and edits) *its* queue, which is only kept
    // fresh while somebody watches it.
    _unwatch = ref.read(connectProvider.notifier).watchRemoteQueue();
  }

  @override
  void dispose() {
    _unwatch?.call();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(playerProvider);
    final notifier = ref.read(playerProvider.notifier);
    final remoteActive =
        ref.watch(connectProvider.select((s) => s.remoteActive));
    final remoteQueue = ref.watch(connectProvider.select((s) => s.remoteQueue));
    final remoteDevice =
        ref.watch(connectProvider.select((s) => s.activeDevice));

    // The list shown, the song playing in it, and where "next up" starts in it.
    final List<Song> queue;
    final Song? current;
    final int base;
    if (remoteActive) {
      queue = remoteQueue?.songs ?? const <Song>[];
      final i = remoteQueue?.index ?? -1;
      current = i >= 0 && i < queue.length ? queue[i] : null;
      base = i + 1;
    } else {
      queue = state.queue;
      current = state.currentSong;
      base = 1;
    }
    // Everything after the currently playing item — its own reorderable,
    // removable list. The current song itself is shown separately below
    // and isn't part of it, so it can't be dragged or removed from here.
    final upNext = queue.length > base ? queue.sublist(base) : <Song>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Queue'),
        actions: [
          if (queue.isNotEmpty && !remoteActive)
            TextButton(
              onPressed: notifier.clearQueue,
              child: const Text('Clear'),
            ),
        ],
      ),
      body: queue.isEmpty
          ? Center(
              child: Text(
                  remoteActive && remoteQueue == null
                      ? 'Loading the queue…'
                      : 'The queue is empty.',
                  style: const TextStyle(color: Color(0xFF71717A))),
            )
          : ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                if (remoteActive && remoteDevice != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: Text('On ${remoteDevice.name}',
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.primary,
                            fontSize: 12)),
                  ),
                if (current != null) ...[
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
                    child: Text('NOW PLAYING', style: _eyebrowStyle),
                  ),
                  SongTile(
                    song: current,
                    showAlbum: true,
                    // No-op: the default tap would replace the whole queue
                    // with just this one song, which isn't right here — it's
                    // already playing.
                    onTap: () {},
                  ),
                ],
                if (upNext.isNotEmpty) ...[
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 20, 16, 4),
                    child: Text('NEXT UP', style: _eyebrowStyle),
                  ),
                  ReorderableListView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: upNext.length,
                    onReorderItem: (oldIndex, newIndex) =>
                        notifier.reorderQueue(oldIndex + base, newIndex + base),
                    itemBuilder: (_, i) {
                      final song = upNext[i];
                      return SongTile(
                        key: ValueKey('${song.id}-${i + base}'),
                        song: song,
                        showAlbum: true,
                        onTap: () => remoteActive
                            ? ref
                                .read(connectProvider.notifier)
                                .playRemoteQueueItem(i + base)
                            : notifier.playFromQueueIndex(i + base),
                        onRemove: () => notifier.removeFromQueue(i + base),
                      );
                    },
                  ),
                ],
              ],
            ),
    );
  }
}
