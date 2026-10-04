import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/widgets/share_sheet.dart';

// A real 1×1 PNG, so Image.memory has something valid to decode.
final _png = Uint8List.fromList(base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));

class _Actions implements SharePicturesActions {
  final shared = <(List<Uint8List>, String)>[];
  final saved = <(List<Uint8List>, String)>[];
  Object? failWith;

  @override
  Future<void> share(List<Uint8List> pictures, String title) async {
    if (failWith != null) throw failWith!;
    shared.add((pictures, title));
  }

  @override
  Future<void> saveToGallery(List<Uint8List> pictures, String title) async {
    if (failWith != null) throw failWith!;
    saved.add((pictures, title));
  }
}

Future<void> _pump(WidgetTester tester, _Actions actions,
    Future<List<Uint8List>> Function() load) async {
  tester.view.physicalSize = const Size(420, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SharePicturesSheet(title: 'Song', load: load, actions: actions),
    ),
  ));
}

void main() {
  group('PlatformSharePicturesActions.fileName', () {
    String name(String t, [int i = 0, int n = 1]) =>
        PlatformSharePicturesActions.fileName(t, i, n);

    test('keeps letters of any alphabet and drops path characters', () {
      expect(name('Road trip / 2024'), 'Road trip 2024');
      expect(name('Şarkı: İstanbul?'), 'Şarkı İstanbul');
    });

    test('never empty, never hidden, length-limited', () {
      expect(name('???'), 'riffplayer');
      expect(name('../../etc'), 'etc');
      expect(name('x' * 500).length, 60);
    });

    test('numbers the pictures of a multi-page playlist', () {
      expect(name('Mix', 0, 3), 'Mix 1');
      expect(name('Mix', 2, 3), 'Mix 3');
    });
  });

  testWidgets('shows progress while the server draws, then the picture',
      (tester) async {
    final actions = _Actions();
    final done = Completer<List<Uint8List>>();
    await _pump(tester, actions, () => done.future);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull);

    done.complete([_png]);
    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    // The preview sits in a lazily built list; look past what the viewport considers on-screen.
    expect(find.byType(Image, skipOffstage: false), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull);
  });

  testWidgets('Share and Save to gallery hand the pictures to the phone',
      (tester) async {
    final actions = _Actions();
    await _pump(tester, actions, () async => [_png, _png]);
    await tester.pumpAndSettle();
    expect(find.textContaining('2 pictures'), findsOneWidget);

    await tester.tap(find.text('Share'));
    await tester.pumpAndSettle();
    expect(actions.shared.single.$1.length, 2);
    expect(actions.shared.single.$2, 'Song');

    await tester.tap(find.text('Save to gallery'));
    await tester.pumpAndSettle();
    expect(actions.saved.single.$1.length, 2);
  });

  testWidgets('says so when the picture could not be made', (tester) async {
    await _pump(tester, _Actions(), () async => throw Exception('server down'));
    await tester.pumpAndSettle();
    expect(find.text("Couldn't create the picture."), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull);
  });

  testWidgets('a failing share is reported, and the buttons come back',
      (tester) async {
    final actions = _Actions()..failWith = Exception('no gallery access');
    await _pump(tester, actions, () async => [_png]);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save to gallery'));
    await tester.pumpAndSettle();

    expect(find.textContaining('didn\'t work'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull);
  });
}
