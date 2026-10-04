import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/audio/equalizer_model.dart';
import 'package:riffplayer_mobile/providers/equalizer_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeBackend implements EqualizerBackend {
  EqBands? layout =
      const EqBands([60, 230, 910, 3600, 14000], -15, 15); // null = not started
  bool? enabled;
  final gains = <int, double>{};

  @override
  Future<EqBands?> bands() async => layout;
  @override
  Future<void> setEnabled(bool e) async => enabled = e;
  @override
  Future<void> setGain(int band, double db) async => gains[band] = db;
}

void main() {
  late _FakeBackend backend;
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    backend = _FakeBackend();
  });

  Future<EqualizerNotifier> started([EqualizerState? initial]) async {
    final n = EqualizerNotifier(backend, initial ?? const EqualizerState());
    await n.refresh();
    return n;
  }

  test('without a started player there are no bands yet', () async {
    backend.layout = null;
    final n = await started();
    expect(n.state.bands, isNull);
    await n.applyPreset('Rock'); // nothing to apply to — must not throw
    expect(n.state.gains, isEmpty);
  });

  test('starts flat on the phone\'s own bands', () async {
    final n = await started();
    expect(n.state.gains, [0, 0, 0, 0, 0]);
    expect(backend.enabled, false);
  });

  test('a preset is sampled onto the phone\'s bands and pushed to the device',
      () async {
    final n = await started();
    await n.applyPreset('Bass boost');
    expect(n.state.preset, 'Bass boost');
    expect(n.state.gains.first, greaterThan(0));
    expect(backend.gains[0], n.state.gains.first);
  });

  test(
      'moving a band makes the preset Custom, and matching a preset again names it',
      () async {
    final n = await started();
    await n.setGain(2, 4);
    expect(n.state.preset, customPreset);
    expect(backend.gains[2], 4);
    await n.setGain(2, 0);
    expect(n.state.preset, 'Flat');
  });

  test(
      'a band is clamped to what the phone supports; a missing band is ignored',
      () async {
    final n = await started();
    await n.setGain(0, 99);
    expect(n.state.gains[0], 15);
    await n.setGain(42, 5);
    expect(n.state.gains.length, 5);
  });

  test('settings are saved and come back on the next start', () async {
    final n = await started();
    await n.setEnabled(true);
    await n.applyPreset('Rock');

    final loaded = await loadEqualizerState();
    expect(loaded.enabled, isTrue);
    expect(loaded.preset, 'Rock');
    expect(loaded.gains, n.state.gains);

    // A new notifier re-applies them to the device when the player starts.
    final backend2 = _FakeBackend();
    final again = EqualizerNotifier(backend2, loaded);
    await again.refresh();
    expect(backend2.enabled, isTrue);
    expect(backend2.gains[0], n.state.gains.first);
  });

  test('saved gains for a different band count are dropped, not misapplied',
      () async {
    final n = await started(const EqualizerState(
        enabled: true, preset: 'Rock', gains: [1, 2, 3])); // 3 saved, 5 bands
    expect(n.state.gains.length, 5);
    expect(
        n.state.preset, 'Rock'); // the curve is re-sampled onto the new bands
  });

  test('corrupted stored gains fall back to nothing', () async {
    SharedPreferences.setMockInitialValues({'eq_gains': 'not json'});
    expect((await loadEqualizerState()).gains, isEmpty);
  });

  test('provider is overridable (as main() does)', () {
    final container = ProviderContainer(overrides: [
      equalizerProvider.overrideWith((ref) => EqualizerNotifier(backend)),
    ]);
    addTearDown(container.dispose);
    expect(container.read(equalizerProvider).enabled, isFalse);
  });
}
