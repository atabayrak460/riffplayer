import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/widgets/quality_filter_menu.dart';

void main() {
  testWidgets('offers three choices and reports the selected one',
      (tester) async {
    String? chosen = 'unset';
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        appBar: AppBar(actions: [
          QualityFilterMenu(value: null, onChanged: (v) => chosen = v),
        ]),
      ),
    ));

    await tester.tap(find.byTooltip('Filter by audio quality'));
    await tester.pumpAndSettle();
    expect(find.text('All quality'), findsOneWidget);
    expect(find.text('Lossless'), findsOneWidget);

    await tester.tap(find.text('Hi-Res only'));
    await tester.pumpAndSettle();
    expect(chosen, 'hires');
  });

  testWidgets('choosing "All quality" reports null (no filter)',
      (tester) async {
    String? chosen = 'hires';
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        appBar: AppBar(actions: [
          QualityFilterMenu(value: 'hires', onChanged: (v) => chosen = v),
        ]),
      ),
    ));
    await tester.tap(find.byTooltip('Filter by audio quality'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All quality'));
    await tester.pumpAndSettle();
    expect(chosen, isNull);
  });
}
