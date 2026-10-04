import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/audio/equalizer_model.dart';
import 'package:riffplayer_mobile/providers/equalizer_provider.dart';
import 'package:riffplayer_mobile/screens/settings_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Backend implements EqualizerBackend {
  _Backend(this.layout);
  EqBands? layout;
  bool? enabled;

  @override
  Future<EqBands?> bands() async => layout;
  @override
  Future<void> setEnabled(bool e) async => enabled = e;
  @override
  Future<void> setGain(int band, double db) async {}
}

Future<_Backend> _pump(WidgetTester tester, EqBands? layout) async {
  SharedPreferences.setMockInitialValues({});
  tester.view.physicalSize = const Size(420, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final backend = _Backend(layout);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      equalizerProvider.overrideWith((ref) => EqualizerNotifier(backend)),
    ],
    child: const MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: EqualizerSection())),
    ),
  ));
  await tester.pump();
  await tester.pump();
  return backend;
}

void main() {
  testWidgets(
      'before any audio has played it asks for a song and offers a retry',
      (tester) async {
    await _pump(tester, null);
    expect(find.textContaining('Play a song once'), findsOneWidget);
    expect(find.text('Check again'), findsOneWidget);
    expect(find.byType(Slider), findsNothing);
  });

  testWidgets('shows one slider per band the phone offers', (tester) async {
    await _pump(tester, const EqBands([60, 230, 910, 3600, 14000], -15, 15));
    expect(find.byType(Slider), findsNWidgets(5));
    expect(find.textContaining('5 bands'), findsOneWidget);
    expect(find.text('14k'), findsOneWidget);
  });

  testWidgets('the switch turns the device equalizer on', (tester) async {
    final backend = await _pump(
        tester, const EqBands([60, 230, 910, 3600, 14000], -15, 15));
    await tester.tap(find.byType(Switch));
    await tester.pump();
    expect(backend.enabled, isTrue);
  });
}
