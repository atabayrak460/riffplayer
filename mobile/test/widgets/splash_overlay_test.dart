import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/widgets/splash_overlay.dart';

Widget _app({bool disableAnimations = false}) => MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(disableAnimations: disableAnimations),
        child: SplashOverlay(child: child!),
      ),
      home: const Scaffold(body: Text('app content')),
    );

void main() {
  setUp(() => SplashOverlay.played = false);

  testWidgets('shows over the app, then disappears by itself', (tester) async {
    await tester.pumpWidget(_app());
    expect(find.byType(Image), findsOneWidget);
    expect(find.text('app content'), findsOneWidget); // app is built underneath

    await tester.pump(const Duration(milliseconds: 1800));
    await tester.pump();
    expect(find.byType(Image), findsNothing);
    expect(find.text('app content'), findsOneWidget);
  });

  testWidgets('a tap skips straight to the fade-out', (tester) async {
    await tester.pumpWidget(_app());
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tapAt(tester.getCenter(find.byType(Scaffold)));
    // Well under the 1.7 s a full run takes — only a skip can finish this fast.
    await tester.pump(); // the restarted animation's first frame
    await tester.pump(const Duration(milliseconds: 450));
    await tester.pump();
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('plays only once per process', (tester) async {
    await tester.pumpWidget(_app());
    await tester.pump(const Duration(milliseconds: 1800));
    await tester.pump();

    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(_app());
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('is skipped when the system disables animations', (tester) async {
    await tester.pumpWidget(_app(disableAnimations: true));
    expect(find.byType(Image), findsNothing);
    expect(find.text('app content'), findsOneWidget);
  });
}
