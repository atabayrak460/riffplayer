import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/widgets/app_scroll_behavior.dart';

void main() {
  Widget app(Widget body) => MaterialApp(
        scrollBehavior: const AppScrollBehavior(),
        home: Scaffold(body: body),
      );

  testWidgets('a long vertical list gets a scrollbar that can be dragged',
      (tester) async {
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(app(ListView.builder(
      controller: controller,
      itemCount: 2000,
      itemExtent: 56,
      itemBuilder: (_, i) => Text('row $i'),
    )));

    expect(find.byType(Scrollbar), findsOneWidget);

    // Grab the thumb (right edge) and pull it most of the way down.
    final size = tester.view.physicalSize / tester.view.devicePixelRatio;
    await tester.fling(find.byType(ListView), const Offset(0, -50), 100);
    await tester.pump();
    final thumb = Offset(size.width - 5, 20);
    final g = await tester.startGesture(thumb);
    await g.moveBy(const Offset(0, 400));
    await g.up();
    await tester.pumpAndSettle();

    // Far more than the 50px flick: the thumb moved the list.
    expect(controller.offset, greaterThan(2000));
  });

  testWidgets('horizontal lists are left alone', (tester) async {
    await tester.pumpWidget(app(SizedBox(
      height: 100,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: 50,
        itemBuilder: (_, i) => SizedBox(width: 80, child: Text('c $i')),
      ),
    )));

    expect(find.byType(Scrollbar), findsNothing);
  });
}
