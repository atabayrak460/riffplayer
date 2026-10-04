import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app_colors.dart';
import '../providers/providers.dart';
import '../widgets/avatar.dart';

/// Everyone on this server: name, bio and — only if they chose to share it — what they are playing now.
class PeopleScreen extends ConsumerWidget {
  const PeopleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(socialEnabledProvider);
    final people = ref.watch(peopleProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('People'), actions: [
        IconButton(
          icon: const Icon(Icons.refresh),
          onPressed: () => ref.invalidate(peopleProvider),
        ),
      ]),
      body: enabled.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => const _Note('Couldn\'t reach the server.'),
        data: (on) {
          if (!on) {
            return const _Note(
                'Social features are turned off on this server.');
          }
          return people.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) =>
                const _Note('Couldn\'t load the people on this server.'),
            data: (list) => ListView(
              children: [
                for (final p in list)
                  ListTile(
                    leading: Avatar(
                        userId: p.id,
                        name: p.displayName,
                        hasAvatar: p.hasAvatar,
                        version: p.avatarVersion,
                        size: 48),
                    title: Text(
                        p.isMe ? '${p.displayName} (you)' : p.displayName,
                        style: TextStyle(color: AppColors.text)),
                    subtitle: Text(
                      p.nowListening != null
                          ? 'Listening to ${p.nowListening!.title} — ${p.nowListening!.artist}'
                          : (p.bio ??
                              '${p.publicPlaylistCount} public ${p.publicPlaylistCount == 1 ? 'playlist' : 'playlists'}'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color: p.nowListening != null
                              ? AppColors.brand
                              : AppColors.muted),
                    ),
                    onTap: () => context.push('/people/${p.id}'),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// One person: picture, bio, what they are playing (if shared) and their public playlists.
class PersonScreen extends ConsumerWidget {
  const PersonScreen({super.key, required this.id});
  final int id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final person = ref.watch(personProvider(id));
    return Scaffold(
      appBar: AppBar(title: Text(person.valueOrNull?.displayName ?? 'Profile')),
      body: person.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => const _Note('Couldn\'t find that person.'),
        data: (p) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Avatar(
                    userId: p.id,
                    name: p.displayName,
                    hasAvatar: p.hasAvatar,
                    version: p.avatarVersion,
                    size: 80),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.displayName,
                          style: TextStyle(
                              color: AppColors.text,
                              fontSize: 20,
                              fontWeight: FontWeight.bold)),
                      Text('@${p.username}',
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 13)),
                      if (p.bio != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(p.bio!,
                              style: TextStyle(color: AppColors.textSecondary)),
                        ),
                      if (p.nowListening != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                              'Listening to ${p.nowListening!.title} — ${p.nowListening!.artist}',
                              style: TextStyle(color: AppColors.brand)),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Text(p.isMe ? 'YOUR PLAYLISTS' : 'PUBLIC PLAYLISTS',
                style: TextStyle(
                    color: AppColors.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2)),
            const SizedBox(height: 8),
            if (p.playlists.isEmpty)
              Text(
                  p.isMe
                      ? 'You have no playlists yet.'
                      : 'No public playlists.',
                  style: TextStyle(color: AppColors.muted)),
            for (final pl in p.playlists)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.queue_music),
                title: Text(pl.name, style: TextStyle(color: AppColors.text)),
                subtitle: Text(
                    '${pl.songCount} ${pl.songCount == 1 ? 'track' : 'tracks'}',
                    style: TextStyle(color: AppColors.muted)),
                onTap: () => context.push('/playlists/${pl.id}'),
              ),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(text,
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.muted)),
        ),
      );
}
