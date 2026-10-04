import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'providers/theme_provider.dart' show AppSkin;

/// Material theme for a palette. Colours come from [AppColors] so widgets that
/// pick a colour by hand and widgets styled by the theme always agree.
ThemeData buildTheme(Palette p, [AppSkin skin = AppSkin.standard]) {
  // Skins differ in shape language, and Winamp titles use a monospace "LED" face.
  final radius = switch (skin) {
    AppSkin.standard => 10.0,
    AppSkin.ipod => 5.0,
    AppSkin.winamp => 0.0,
    AppSkin.vista => 6.0,
  };
  final titleFont = skin == AppSkin.winamp ? 'monospace' : null;
  // Vista paints a gradient behind the app (see SkinBackdrop), so scaffolds must be see-through.
  final scaffoldColor =
      skin == AppSkin.vista ? Colors.transparent : p.background;
  final scheme = p.brightness == Brightness.dark
      ? ColorScheme.dark(
          primary: p.brand,
          onPrimary: p.onBrand,
          secondary: p.sea,
          surface: p.surface,
          onSurface: p.text,
          surfaceContainerHighest: p.surface2,
          error: p.danger,
        )
      : ColorScheme.light(
          primary: p.brand,
          onPrimary: p.onBrand,
          secondary: p.sea,
          surface: p.surface,
          onSurface: p.text,
          surfaceContainerHighest: p.surface2,
          error: p.danger,
        );
  return ThemeData(
    useMaterial3: true,
    brightness: p.brightness,
    scaffoldBackgroundColor: scaffoldColor,
    colorScheme: scheme,
    appBarTheme: AppBarTheme(
      backgroundColor:
          skin == AppSkin.vista ? Colors.transparent : p.background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      titleTextStyle: TextStyle(
        color: p.text,
        fontSize: 18,
        fontWeight: skin == AppSkin.vista ? FontWeight.w300 : FontWeight.w600,
        fontFamily: titleFont,
        letterSpacing: skin == AppSkin.winamp ? 1.5 : null,
      ),
      iconTheme: IconThemeData(color: p.text),
    ),
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: p.surface,
      selectedItemColor: p.brand,
      unselectedItemColor: p.muted,
      type: BottomNavigationBarType.fixed,
      showSelectedLabels: true,
      showUnselectedLabels: true,
      selectedLabelStyle: const TextStyle(fontSize: 11),
      unselectedLabelStyle: const TextStyle(fontSize: 11),
    ),
    listTileTheme: ListTileThemeData(
      textColor: p.text,
      iconColor: p.muted,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: p.surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide(color: p.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide(color: p.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide(color: p.brand, width: 2),
      ),
      labelStyle: TextStyle(color: p.muted),
      hintStyle: TextStyle(color: p.muted),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: p.brand,
        foregroundColor: p.onBrand,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    cardTheme: CardThemeData(
      color: p.surface,
      elevation: 0,
      shape:
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
    ),
  );
}

/// Android status / navigation bars follow the theme (otherwise the OEM
/// default — often a light bar with dark icons on MIUI — clashes with it).
void applySystemChrome(Palette p) {
  final iconBrightness =
      p.brightness == Brightness.dark ? Brightness.light : Brightness.dark;
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: iconBrightness,
    statusBarBrightness: p.brightness,
    systemNavigationBarColor: p.background,
    systemNavigationBarIconBrightness: iconBrightness,
    systemNavigationBarDividerColor: Colors.transparent,
  ));
}

/// Backdrop behind the whole app for skins that paint one (Vista's Aero glow);
/// a plain pass-through for every other look.
class SkinBackdrop extends StatelessWidget {
  const SkinBackdrop({super.key, required this.skin, required this.child});

  final AppSkin skin;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (skin != AppSkin.vista) return child;
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF0D1A30), Color(0xFF050B16)],
        ),
      ),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.76, 1.1),
            radius: 0.9,
            colors: [Color(0x61389CF5), Color(0x00389CF5)],
          ),
        ),
        child: child,
      ),
    );
  }
}
