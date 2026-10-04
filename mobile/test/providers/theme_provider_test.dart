import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/app_colors.dart';
import 'package:riffplayer_mobile/providers/theme_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    AppColors.current = darkPalette;
  });
  tearDown(() => AppColors.current = darkPalette);

  group('resolveBrightness', () {
    test('system follows the device, explicit modes ignore it', () {
      expect(resolveBrightness(AppThemeMode.system, Brightness.light),
          Brightness.light);
      expect(resolveBrightness(AppThemeMode.system, Brightness.dark),
          Brightness.dark);
      expect(resolveBrightness(AppThemeMode.dark, Brightness.light),
          Brightness.dark);
      expect(resolveBrightness(AppThemeMode.light, Brightness.dark),
          Brightness.light);
    });
  });

  group('persistence', () {
    test('defaults to system when nothing is stored', () async {
      expect(await loadThemeMode(), AppThemeMode.system);
    });

    test('a chosen mode is stored and loaded next start', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await container.read(themeModeProvider.notifier).set(AppThemeMode.light);
      expect(container.read(themeModeProvider), AppThemeMode.light);
      expect(await loadThemeMode(), AppThemeMode.light);
    });

    test('an unknown stored value falls back to system', () async {
      SharedPreferences.setMockInitialValues({'theme_mode': 'sepia'});
      expect(await loadThemeMode(), AppThemeMode.system);
    });
  });

  group('palettes', () {
    test('the active palette is what AppColors reads', () {
      expect(AppColors.brand, darkPalette.brand);
      AppColors.current = lightPalette;
      expect(AppColors.brand, lightPalette.brand);
      expect(AppColors.text, lightPalette.text);
    });

    test('text stays readable on its background in both themes', () {
      double contrast(Color a, Color b) {
        final la = a.computeLuminance() + 0.05;
        final lb = b.computeLuminance() + 0.05;
        return la > lb ? la / lb : lb / la;
      }

      for (final p in [
        darkPalette,
        lightPalette,
        ipodPalette,
        winampPalette,
        vistaPalette
      ]) {
        expect(contrast(p.text, p.background), greaterThan(7),
            reason: '${p.brightness} text');
        expect(contrast(p.muted, p.background), greaterThan(3.9),
            reason: '${p.brightness} muted');
        expect(contrast(p.brand, p.background), greaterThan(4.5),
            reason: '${p.brightness} brand text');
        expect(contrast(p.onBrand, p.brand), greaterThan(4.5),
            reason: '${p.brightness} on-brand');
      }
    });
  });

  group('interface styles', () {
    test('the standard look follows the theme mode', () {
      expect(
          resolvePalette(AppThemeMode.dark, AppSkin.standard, Brightness.light),
          same(darkPalette));
      expect(
          resolvePalette(AppThemeMode.light, AppSkin.standard, Brightness.dark),
          same(lightPalette));
      expect(
          resolvePalette(
              AppThemeMode.system, AppSkin.standard, Brightness.light),
          same(lightPalette));
    });

    test('a skin brings its own palette and ignores the theme mode', () {
      for (final mode in AppThemeMode.values) {
        for (final platform in Brightness.values) {
          expect(
              resolvePalette(mode, AppSkin.ipod, platform), same(ipodPalette));
          expect(resolvePalette(mode, AppSkin.winamp, platform),
              same(winampPalette));
          expect(resolvePalette(mode, AppSkin.vista, platform),
              same(vistaPalette));
        }
      }
    });

    test('the chosen skin is stored and loaded next start', () async {
      expect(await loadSkin(), AppSkin.standard);
      final container = ProviderContainer();
      addTearDown(container.dispose);
      await container.read(skinProvider.notifier).set(AppSkin.winamp);
      expect(container.read(skinProvider), AppSkin.winamp);
      expect(await loadSkin(), AppSkin.winamp);
    });

    test('an unknown stored skin falls back to the standard look', () async {
      SharedPreferences.setMockInitialValues({'ui_style': 'geocities'});
      expect(await loadSkin(), AppSkin.standard);
    });

    test('every skin has a label for the settings screen', () {
      expect(skinLabels.keys, containsAll(AppSkin.values));
    });
  });

  testWidgets('rebuildAll repaints widgets that read AppColors statics',
      (tester) async {
    await tester.pumpWidget(Directionality(
      textDirection: TextDirection.ltr,
      child: Builder(
        // Not const, and no dependency on any InheritedWidget: only
        // rebuildAll can make this pick up a palette change.
        builder: (_) => ColoredBox(color: AppColors.background),
      ),
    ));
    expect(tester.widget<ColoredBox>(find.byType(ColoredBox)).color,
        darkPalette.background);

    AppColors.current = lightPalette;
    rebuildAll();
    await tester.pump();

    expect(tester.widget<ColoredBox>(find.byType(ColoredBox)).color,
        lightPalette.background);
  });
}
