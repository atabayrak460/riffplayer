import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/providers.dart';
import '../utils/library_sidebar_order.dart';
import '../widgets/library_list_row.dart';
import '../app_colors.dart';

const _systemItems = <LibraryRow>[
  LibraryRow(
      itemType: 'system',
      itemKey: 'albums',
      to: '/albums',
      label: 'Albums',
      stockCoverKey: 'albums'),
  LibraryRow(
      itemType: 'system',
      itemKey: 'all-songs',
      to: '/songs',
      label: 'All Songs',
      stockCoverKey: 'all-songs'),
  LibraryRow(
      itemType: 'system',
      itemKey: 'favorites',
      to: '/favorites',
      label: 'Favourites',
      stockCoverKey: 'favorites'),
  LibraryRow(
      itemType: 'system',
      itemKey: 'recent',
      to: '/recent',
      label: 'Recently Played',
      stockCoverKey: 'recent'),
  LibraryRow(
      itemType: 'system',
      itemKey: 'most-played',
      to: '/most-played',
      label: 'Most Played',
      stockCoverKey: 'most-played'),
  LibraryRow(
      itemType: 'system',
      itemKey: 'downloaded',
      to: '/downloads',
      label: 'Downloaded',
      stockCoverKey: 'downloaded'),
  LibraryRow(
      itemType: 'system',
      itemKey: 'discover',
      to: '/discover',
      label: 'Discover',
      stockCoverKey: 'discover'),
  LibraryRow(
      itemType: 'system',
      itemKey: 'wrapped',
      to: '/wrapped',
      label: 'Wrapped',
      stockCoverKey: 'wrapped'),
];

class LibraryScreen extends ConsumerWidget {
  const LibraryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final playlistsAsync = ref.watch(playlistsProvider);
    final stateAsync = ref.watch(librarySidebarStateProvider);

    // Playlists need a network round-trip; the system rows (Albums,
    // Favourites, Downloaded, ...) don't — Downloaded in particular is the
    // one offline users need to reach. So the system rows always render,
    // regardless of whether the playlists fetch is loading/failed, and only
    // the playlist rows themselves are conditional on it succeeding. This
    // screen used to gate its *entire* body on playlistsAsync, which meant
    // being offline (or the server being briefly unreachable) hid every
    // system row — including Downloaded — behind a plain "Error: ..." text.
    final playlists = playlistsAsync.valueOrNull ?? const [];
    final rows = <LibraryRow>[
      ..._systemItems,
      ...playlists.map((pl) => LibraryRow(
            itemType: 'playlist',
            itemKey: pl.id,
            to: '/playlists/${pl.id}',
            label: pl.name,
            coverArt: pl.coverArt,
          )),
    ];

    // While sidebar state is still loading (or failed to load), fall back to
    // declared order rather than blocking the whole screen.
    final order = orderLibraryRows(rows, stateAsync.valueOrNull ?? const []);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Library'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'New playlist',
            onPressed: () => _createPlaylist(context, ref),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        children: [
          if (order.pinned.isNotEmpty) ...[
            ...order.pinned.map((row) => _row(context, ref, row, pinned: true)),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Divider(color: AppColors.surface, height: 1),
            ),
          ],
          ...order.dynamic_
              .map((row) => _row(context, ref, row, pinned: false)),
          if (playlistsAsync.isLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (playlistsAsync.hasError)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Text(
                'Playlists unavailable — check your connection.',
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ),
          const SizedBox(height: 80),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, WidgetRef ref, LibraryRow row,
      {required bool pinned}) {
    return LibraryListRow(
      key: ValueKey('${row.itemType}:${row.itemKey}'),
      label: row.label,
      coverArt: row.coverArt,
      stockCoverKey: row.stockCoverKey,
      pinned: pinned,
      onTap: () => _open(context, ref, row),
      onLongPress: () => _showPinMenu(context, ref, row, pinned: pinned),
    );
  }

  void _open(BuildContext context, WidgetRef ref, LibraryRow row) {
    context.push(row.to);
    final client = ref.read(apiClientProvider);
    // Best-effort recency tracking for sidebar ordering — never blocks
    // navigation (already happened above) and failing offline shouldn't
    // surface as an error, just skip the reorder.
    client
        ?.recordLibraryInteraction(row.itemType, row.itemKey)
        .then((_) => ref.invalidate(librarySidebarStateProvider))
        .catchError((_) {})
        .ignore();
  }

  void _showPinMenu(BuildContext context, WidgetRef ref, LibraryRow row,
      {required bool pinned}) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.background,
      builder: (sheetContext) => SafeArea(
        child: ListTile(
          leading: Icon(pinned ? Icons.push_pin_outlined : Icons.push_pin,
              color: AppColors.text),
          title: Text(pinned ? 'Unpin' : 'Pin',
              style: TextStyle(color: AppColors.text)),
          onTap: () async {
            Navigator.pop(sheetContext);
            final client = ref.read(apiClientProvider);
            if (client == null) return;
            if (pinned) {
              await client.unpinLibraryItem(row.itemType, row.itemKey);
            } else {
              await client.pinLibraryItem(row.itemType, row.itemKey);
            }
            ref.invalidate(librarySidebarStateProvider);
          },
        ),
      ),
    );
  }

  Future<void> _createPlaylist(BuildContext context, WidgetRef ref) async {
    final nameCtrl = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('New playlist'),
        content: TextField(
          controller: nameCtrl,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Playlist name'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, nameCtrl.text.trim()),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;

    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final playlist = await client.createPlaylist(name);
    ref.invalidate(playlistsProvider);
    if (context.mounted) context.push('/playlists/${playlist.id}');
  }
}
