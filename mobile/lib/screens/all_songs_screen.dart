import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../widgets/quality_filter_menu.dart';
import '../widgets/song_tile.dart';
import '../app_colors.dart';

const _pageSize = 200;

class AllSongsScreen extends ConsumerStatefulWidget {
  const AllSongsScreen({super.key});

  @override
  ConsumerState<AllSongsScreen> createState() => _AllSongsScreenState();
}

class _AllSongsScreenState extends ConsumerState<AllSongsScreen> {
  final List<Song> _songs = [];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = true;
  String? _error;
  String? _genre;
  String? _quality;
  String _sort = 'title';
  // Bumped on every filter/sort change so a slow response for the previous
  // choice can't overwrite the list for the current one.
  int _generation = 0;

  // Next page is requested this far (px) before the end of the list, so it is
  // usually there before the user gets to the bottom.
  static const _loadMoreThreshold = 800.0;
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _load();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    final pos = _scrollController.position;
    if (pos.extentAfter < _loadMoreThreshold) _loadMore();
  }

  Future<void> _load() async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final gen = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await client.getAllSongs(0, _pageSize,
          genre: _genre, sort: _sort, quality: _quality);
      if (gen != _generation) return;
      setState(() {
        _songs
          ..clear()
          ..addAll(page);
        _hasMore = page.length == _pageSize;
        _loading = false;
      });
    } catch (e) {
      if (gen != _generation) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final client = ref.read(apiClientProvider);
    if (client == null || _loadingMore || !_hasMore) return;
    final gen = _generation;
    setState(() => _loadingMore = true);
    try {
      final page = await client.getAllSongs(_songs.length, _pageSize,
          genre: _genre, sort: _sort, quality: _quality);
      if (gen != _generation) return;
      setState(() {
        _songs.addAll(page);
        _hasMore = page.length == _pageSize;
        _loadingMore = false;
      });
    } catch (_) {
      if (gen == _generation) setState(() => _loadingMore = false);
    }
  }

  void _setSort(String sort) {
    if (sort == _sort) return;
    _sort = sort;
    _load();
  }

  Future<void> _pickGenre() async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final genres = await client.getGenres();
    if (!mounted) return;
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        builder: (_, controller) => ListView(
          controller: controller,
          children: [
            ListTile(
              title: const Text('All genres'),
              trailing: _genre == null ? const Icon(Icons.check) : null,
              onTap: () => Navigator.pop(ctx, ''),
            ),
            for (final g in genres)
              ListTile(
                title: Text(g.name),
                subtitle: Text('${g.songCount} songs'),
                trailing: _genre == g.name ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(ctx, g.name),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    final next = picked.isEmpty ? null : picked;
    if (next == _genre) return;
    _genre = next;
    _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('All Songs'),
        actions: [
          IconButton(
            tooltip: 'Filter by genre',
            icon: Icon(
                _genre == null ? Icons.filter_list : Icons.filter_list_alt),
            color:
                _genre == null ? null : Theme.of(context).colorScheme.primary,
            onPressed: _pickGenre,
          ),
          QualityFilterMenu(
            value: _quality,
            onChanged: (q) {
              if (q == _quality) return;
              _quality = q;
              _load();
            },
          ),
          PopupMenuButton<String>(
            tooltip: 'Sort',
            icon: const Icon(Icons.sort),
            initialValue: _sort,
            onSelected: _setSort,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'title', child: Text('Title (A–Z)')),
              PopupMenuItem(value: 'added_desc', child: Text('Recently added')),
              PopupMenuItem(value: 'added_asc', child: Text('Oldest added')),
            ],
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Text('Error: $_error',
                      style: TextStyle(color: AppColors.danger)),
                )
              : _songs.isEmpty
                  ? Center(
                      child: Text(
                          _genre == null && _quality == null
                              ? 'No songs found.'
                              : 'No songs match these filters.',
                          style: TextStyle(color: AppColors.muted)),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      itemCount: _songs.length + 1,
                      itemBuilder: (_, i) {
                        if (i == _songs.length) {
                          // Scrolling loads the next page (see _onScroll); this
                          // only shows that one is on its way.
                          return SizedBox(
                            height: 64,
                            child: Center(
                              child: _loadingMore
                                  ? const CircularProgressIndicator()
                                  : null,
                            ),
                          );
                        }
                        final song = _songs[i];
                        return SongTile(
                          song: song,
                          queue: _songs,
                          index: i,
                          showAlbum: true,
                          addedAt: song.created,
                        );
                      },
                    ),
    );
  }
}
