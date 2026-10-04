import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/widgets/cover_flow.dart';

Album _album(int i) => Album(
    id: 'a$i',
    name: 'Album $i',
    artist: 'Artist $i',
    artistId: 'x',
    songCount: 1,
    duration: 1);

void main() {
  late List<Album> opened;
  late List<Album> played;

  Future<void> pump(WidgetTester tester, List<Album> albums) async {
    tester.view.physicalSize = const Size(400, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    opened = [];
    played = [];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: CoverFlow(
          albums: albums,
          coverUrl: (_, __) => null,
          onOpen: opened.add,
          onPlay: played.add,
        ),
      ),
    ));
  }

  test('covers stop turning past one page from the centre', () {
    expect(coverFlowTurn(0), 0);
    expect(coverFlowTurn(0.5), 0.5);
    expect(coverFlowTurn(3), 1);
    expect(coverFlowTurn(-3), -1);
  });

  testWidgets('shows the first album\'s title and artist', (tester) async {
    await pump(tester, List.generate(6, _album));
    expect(find.text('Album 0'), findsOneWidget);
    expect(find.text('Artist 0'), findsOneWidget);
  });

  testWidgets('swiping moves to the next album', (tester) async {
    await pump(tester, List.generate(6, _album));
    await tester.drag(find.byType(PageView), const Offset(-250, 0));
    await tester.pumpAndSettle();
    expect(find.text('Album 1'), findsOneWidget);
    expect(find.text('Album 0'), findsNothing);
  });

  testWidgets('tapping the centred cover opens it, a side cover brings it in',
      (tester) async {
    await pump(tester, List.generate(6, _album));

    await tester.tapAt(const Offset(200, 250)); // the centred cover
    expect(opened.map((a) => a.id), ['a0']);

    await tester.tapAt(const Offset(370, 250)); // the neighbour on the right
    await tester.pumpAndSettle();
    expect(find.text('Album 1'), findsOneWidget);
    expect(opened.length, 1, reason: 'a side tap only moves, it does not open');
  });

  testWidgets('Play plays the centred album', (tester) async {
    await pump(tester, List.generate(6, _album));
    await tester.drag(find.byType(PageView), const Offset(-250, 0));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Play'));
    expect(played.map((a) => a.id), ['a1']);
  });

  testWidgets('copes with a single album and with none', (tester) async {
    await pump(tester, [_album(0)]);
    expect(find.text('Album 0'), findsOneWidget);

    await pump(tester, []);
    expect(find.byType(PageView), findsNothing);
  });
}
