import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../app_colors.dart';

enum AppThemeMode { system, dark, light }

/// Interface style: the standard look, or one of the retro skins (same set as the web app).
enum AppSkin { standard, ipod, winamp, vista }

const skinLabels = {
  AppSkin.standard: ('RiffPlayer', 'The standard look'),
  AppSkin.ipod: ('iPod Classic', 'Silver, glossy blue, Cover Flow'),
  AppSkin.winamp: ('Winamp', 'Metal grey, LED green'),
  AppSkin.vista: ('Windows Vista', 'Aero glass, glossy blue'),
};

const _prefsKey = 'theme_mode';
const _skinKey = 'ui_style';

/// Dark / light / follow-the-system, persisted. [initial] comes from main()
/// (read before the first frame, so the app never flashes the wrong theme).
class ThemeModeNotifier extends StateNotifier<AppThemeMode> {
  ThemeModeNotifier([super.initial = AppThemeMode.system]);

  Future<void> set(AppThemeMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, mode.name);
  }
}

final themeModeProvider =
    StateNotifierProvider<ThemeModeNotifier, AppThemeMode>(
        (ref) => ThemeModeNotifier());

/// The chosen interface style, persisted. [initial] comes from main().
class SkinNotifier extends StateNotifier<AppSkin> {
  SkinNotifier([super.initial = AppSkin.standard]);

  Future<void> set(AppSkin skin) async {
    state = skin;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_skinKey, skin.name);
  }
}

final skinProvider =
    StateNotifierProvider<SkinNotifier, AppSkin>((ref) => SkinNotifier());

Future<AppSkin> loadSkin() async {
  final prefs = await SharedPreferences.getInstance();
  final saved = prefs.getString(_skinKey);
  return AppSkin.values
      .firstWhere((m) => m.name == saved, orElse: () => AppSkin.standard);
}

/// The palette in force: a skin brings its own colours (and ignores the
/// dark/light choice); the standard look follows the theme mode.
Palette resolvePalette(AppThemeMode mode, AppSkin skin, Brightness platform) =>
    switch (skin) {
      AppSkin.ipod => ipodPalette,
      AppSkin.winamp => winampPalette,
      AppSkin.vista => vistaPalette,
      AppSkin.standard =>
        AppColors.forBrightness(resolveBrightness(mode, platform)),
    };

Future<AppThemeMode> loadThemeMode() async {
  final prefs = await SharedPreferences.getInstance();
  final saved = prefs.getString(_prefsKey);
  return AppThemeMode.values
      .firstWhere((m) => m.name == saved, orElse: () => AppThemeMode.system);
}

/// The brightness a mode resolves to, given the device's current setting.
Brightness resolveBrightness(AppThemeMode mode, Brightness platform) =>
    switch (mode) {
      AppThemeMode.dark => Brightness.dark,
      AppThemeMode.light => Brightness.light,
      AppThemeMode.system => platform,
    };

/// Re-evaluates every widget. Colours are read through [AppColors] statics
/// (not an InheritedWidget), so after the palette changes nothing would
/// otherwise know to repaint widgets that were built earlier.
void rebuildAll() {
  void visit(Element e) {
    e.markNeedsBuild();
    e.visitChildren(visit);
  }

  WidgetsBinding.instance.rootElement?.visitChildren(visit);
}
