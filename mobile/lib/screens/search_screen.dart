import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/providers.dart';
import '../widgets/song_tile.dart';
import '../app_colors.dart';

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _ctrl = TextEditingController();
  String _submitted = '';

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final resultsAsync = ref.watch(searchProvider(_submitted));

    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _ctrl,
          autofocus: false,
          style: TextStyle(color: AppColors.text),
          decoration: const InputDecoration(
            hintText: 'Artists, albums, songs…',
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
          ),
          onSubmitted: (v) => setState(() => _submitted = v.trim()),
          textInputAction: TextInputAction.search,
        ),
        actions: [
          if (_ctrl.text.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.clear),
              onPressed: () {
                _ctrl.clear();
                setState(() => _submitted = '');
              },
            ),
        ],
      ),
      body: _submitted.isEmpty
          ? Center(
              child: Text('Search for music',
                  style: TextStyle(color: AppColors.muted)),
            )
          : resultsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('Error: $e')),
              data: (results) {
                if (results.artists.isEmpty &&
                    results.albums.isEmpty &&
                    results.songs.isEmpty) {
                  return Center(
                    child: Text('No results for "$_submitted"',
                        style: TextStyle(color: AppColors.muted)),
                  );
                }
                return ListView(
                  children: [
                    if (results.songs.isNotEmpty) ...[
                      const _SectionHeader('Songs'),
                      ...results.songs.map((s) => SongTile(
                            song: s,
                            queue: results.songs,
                            showAlbum: true,
                          )),
                    ],
                    if (results.artists.isNotEmpty) ...[
                      const _SectionHeader('Artists'),
                      ...results.artists.map((a) => ListTile(
                            onTap: () => context.push('/artists/${a.id}'),
                            leading: Icon(Icons.person, color: AppColors.muted),
                            title: Text(a.name,
                                style: TextStyle(color: AppColors.text)),
                          )),
                    ],
                    if (results.albums.isNotEmpty) ...[
                      const _SectionHeader('Albums'),
                      ...results.albums.map((a) => ListTile(
                            onTap: () => context.push('/albums/${a.id}'),
                            leading: Icon(Icons.album, color: AppColors.muted),
                            title: Text(a.name,
                                style: TextStyle(color: AppColors.text)),
                            subtitle: Text(a.artist,
                                style: TextStyle(
                                    color: AppColors.muted, fontSize: 12)),
                          )),
                    ],
                    const SizedBox(height: 80),
                  ],
                );
              },
            ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
        child: Text(
          title.toUpperCase(),
          style: TextStyle(
            color: AppColors.muted,
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.2,
          ),
        ),
      );
}
