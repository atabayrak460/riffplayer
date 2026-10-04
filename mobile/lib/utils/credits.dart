const _labels = <(String, String)>[
  ('albumArtist', 'Album artist'),
  ('artists', 'Artists'),
  ('composers', 'Composer'),
  ('lyricists', 'Lyrics'),
  ('writers', 'Written by'),
  ('producers', 'Producer'),
  ('conductors', 'Conductor'),
  ('arrangers', 'Arranger'),
  ('engineers', 'Engineer'),
  ('mixers', 'Mixer'),
  ('remixers', 'Remixer'),
  ('djMixers', 'DJ mixer'),
  ('labels', 'Label'),
  ('catalogNumbers', 'Catalogue no.'),
  ('isrc', 'ISRC'),
  ('releaseDate', 'Released'),
  ('originalYear', 'Original year'),
  ('bpm', 'BPM'),
  ('key', 'Key'),
  ('mood', 'Mood'),
  ('copyright', 'Copyright'),
];

/// The server's credits JSON as display rows ("Composer" → "A, B"), in a fixed
/// order, skipping anything empty. Twin of `web/src/lib/credits.ts`.
List<(String, String)> creditRows(Map<String, dynamic> credits) {
  final rows = <(String, String)>[];
  for (final (key, label) in _labels) {
    final value = credits[key];
    if (value == null) continue;
    final text = value is List ? value.join(', ') : '$value';
    if (text.isNotEmpty) rows.add((label, text));
  }
  return rows;
}
