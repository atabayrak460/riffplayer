import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/tv/tv_widgets.dart';

void main() {
  testWidgets('the remote Select key activates the focused item', (t) async {
    var hits = 0;
    await t.pumpWidget(MaterialApp(
      home: Row(children: [
        TvFocusable(
            autofocus: true,
            onActivate: () => hits++,
            child: const SizedBox(width: 80, height: 40, child: Text('A'))),
        TvFocusable(
            onActivate: () => hits += 100,
            child: const SizedBox(width: 80, height: 40, child: Text('B'))),
      ]),
    ));
    await t.pump();

    await t.sendKeyEvent(LogicalKeyboardKey.select);
    await t.pump();
    expect(hits, 1);

    await t.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await t.pump();
    await t.sendKeyEvent(LogicalKeyboardKey.enter);
    await t.pump();
    expect(hits, 101);
  });

  test('tvFormatDuration renders m:ss', () {
    expect(tvFormatDuration(const Duration(seconds: 185)), '3:05');
  });
}
