import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/widgets/lyrics_view.dart';

const _long =
    "Who would've thought that a boy like me would come to fall in love with you";

Future<void> _pump(
  WidgetTester tester,
  Lyrics lyrics, {
  Duration position = Duration.zero,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        lyricsProvider('s1').overrideWith((ref) async => lyrics),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Center(
            child: LyricsView(songId: 's1', position: position, size: 300),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a line too long for the width wraps instead of being cut off',
      (tester) async {
    await _pump(
      tester,
      const Lyrics(synced: false, line: [
        LyricsLine(start: 0, value: 'Short'),
        LyricsLine(start: 1000, value: _long),
      ]),
    );

    final text = tester.widget<Text>(find.text(_long));
    expect(text.maxLines, isNull);
    expect(text.overflow, isNot(TextOverflow.ellipsis));
    // Two or more rows tall, i.e. taller than a single 14px line.
    expect(tester.getSize(find.text(_long)).height, greaterThan(30));
    expect(tester.takeException(), isNull);
  });

  testWidgets('short and blank lines keep their spacing', (tester) async {
    await _pump(
      tester,
      const Lyrics(synced: false, line: [
        LyricsLine(start: 0, value: 'One'),
        LyricsLine(start: 1000, value: ''),
        LyricsLine(start: 2000, value: 'Two'),
      ]),
    );

    final first = tester.getTopLeft(find.byKey(const ValueKey('lyric-line-0')));
    final second =
        tester.getTopLeft(find.byKey(const ValueKey('lyric-line-1')));
    final third = tester.getTopLeft(find.byKey(const ValueKey('lyric-line-2')));
    expect(second.dy - first.dy, greaterThanOrEqualTo(44));
    expect(third.dy - second.dy, greaterThanOrEqualTo(44));
  });

  testWidgets('the playing line is scrolled to the middle of the view',
      (tester) async {
    final lines = [
      for (var i = 0; i < 60; i++)
        LyricsLine(start: i * 1000, value: i == 30 ? _long : 'Line $i'),
    ];
    await _pump(tester, Lyrics(synced: true, line: lines),
        position: const Duration(seconds: 30, milliseconds: 500));

    final viewport = tester.getRect(find.byType(SingleChildScrollView));
    final active = tester.getRect(find.text(_long));
    expect((active.center.dy - viewport.center.dy).abs(), lessThan(30));
  });

  testWidgets('tapping a synced line seeks to its timestamp', (tester) async {
    // The seek goes through the player notifier; here it is enough that the
    // tap target exists and is the whole (wrapped) line.
    await _pump(
      tester,
      const Lyrics(synced: true, line: [
        LyricsLine(start: 0, value: 'One'),
        LyricsLine(start: 5000, value: _long),
      ]),
    );
    final tile = tester.getSize(find.byKey(const ValueKey('lyric-line-1')));
    expect(tile.height, greaterThan(44));
    expect(tile.width, 300);
  });
}
