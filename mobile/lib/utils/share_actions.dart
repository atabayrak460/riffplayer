import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/types.dart';
import '../providers/providers.dart';
import '../widgets/share_sheet.dart';

/// Opens the share sheet for one song: a picture the server draws, then Share / Save to gallery.
void shareSongAsPicture(BuildContext context, WidgetRef ref, Song song) {
  final client = ref.read(apiClientProvider);
  if (client == null) return;
  showSharePicturesSheet(
    context,
    title: '${song.artist} - ${song.title}',
    load: () async => [await client.getSongShareImage(song.id)],
  );
}

/// The same for a playlist, which may need several pictures.
void sharePlaylistAsPicture(
    BuildContext context, WidgetRef ref, Playlist playlist) {
  final client = ref.read(apiClientProvider);
  if (client == null) return;
  showSharePicturesSheet(
    context,
    title: playlist.name,
    load: () async {
      final pages = await client.getPlaylistSharePages(playlist.id);
      return [
        for (var n = 1; n <= pages; n++)
          await client.getPlaylistShareImage(playlist.id, n),
      ];
    },
  );
}
