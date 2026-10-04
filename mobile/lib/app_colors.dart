import 'package:flutter/material.dart';

/// One complete colour palette. The mobile twin of the web's CSS variables
/// (`web/src/index.css`): a neutral ramp for backgrounds/text plus the amber
/// brand and sea-blue secondary accent. Keep the two in step.
class Palette {
  const Palette({
    required this.brightness,
    required this.background,
    required this.surface,
    required this.surface2,
    required this.border,
    required this.muted,
    required this.mutedLight,
    required this.textSecondary,
    required this.text,
    required this.brand,
    required this.brandDim,
    required this.onBrand,
    required this.sea,
    required this.danger,
    required this.warning,
    required this.success,
  });

  final Brightness brightness;
  final Color background; // page background
  final Color surface; // cards, bars, inputs
  final Color surface2; // raised / selected surfaces
  final Color border;
  final Color muted; // secondary text and icons
  final Color mutedLight; // slightly stronger secondary text
  final Color textSecondary;
  final Color text; // primary text
  final Color brand;
  final Color brandDim;
  final Color onBrand; // text/icons on a brand-coloured fill
  final Color sea;
  final Color danger;
  final Color warning;
  final Color success;
}

/// Deep navy + amber.
const darkPalette = Palette(
  brightness: Brightness.dark,
  background: Color(0xFF0D1524),
  surface: Color(0xFF152136),
  surface2: Color(0xFF21314D),
  border: Color(0xFF324566),
  muted: Color(0xFF6C80A0),
  mutedLight: Color(0xFF8C9CB8),
  textSecondary: Color(0xFFB4C0D4),
  text: Color(0xFFF4F6FA),
  brand: Color(0xFFF5A524),
  brandDim: Color(0xFFD97706),
  onBrand: Color(0xFF080E1A),
  sea: Color(0xFF4FA6E0),
  danger: Color(0xFFF87171),
  warning: Color(0xFFFBBF24),
  success: Color(0xFF4ADE80),
);

/// Warm cream + deep amber.
const lightPalette = Palette(
  brightness: Brightness.light,
  background: Color(0xFFF3EEE4),
  surface: Color(0xFFE8E1D3),
  surface2: Color(0xFFD6CDBB),
  border: Color(0xFFBCB19C),
  muted: Color(0xFF786E5E),
  mutedLight: Color(0xFF5C5446),
  textSecondary: Color(0xFF423C32),
  text: Color(0xFF11100D),
  brand: Color(0xFFA04508),
  brandDim: Color(0xFF7C2D12),
  onBrand: Color(0xFFFFFFFF),
  sea: Color(0xFF1C64A0),
  danger: Color(0xFFB91C1C),
  warning: Color(0xFF92400E),
  success: Color(0xFF15803D),
);

// ── Interface-style palettes (mirror the web skins in `web/src/index.css`) ───
// Each skin brings its own fixed colours, so the dark/light choice doesn't apply to them.

/// iPod Classic: aluminium and a white "screen", iPod selection blue.
const ipodPalette = Palette(
  brightness: Brightness.light,
  background: Color(0xFFFFFFFF),
  surface: Color(0xFFE3E7ED),
  surface2: Color(0xFFCDD3DC),
  border: Color(0xFFB0B8C4),
  muted: Color(0xFF626C7A),
  mutedLight: Color(0xFF4A5260),
  textSecondary: Color(0xFF333A46),
  text: Color(0xFF000000),
  brand: Color(0xFF1F6BC2),
  brandDim: Color(0xFF1A55A0),
  onBrand: Color(0xFFFFFFFF),
  sea: Color(0xFF3A8FD9),
  danger: Color(0xFFB91C1C),
  warning: Color(0xFF92400E),
  success: Color(0xFF15803D),
);

/// Winamp 2.x: slate metal, a black LED display and bright green text.
const winampPalette = Palette(
  brightness: Brightness.dark,
  background: Color(0xFF080A08),
  surface: Color(0xFF262836),
  surface2: Color(0xFF484C62),
  border: Color(0xFF646A86),
  muted: Color(0xFF009600),
  mutedLight: Color(0xFF00BE00),
  textSecondary: Color(0xFF5AEB5A),
  text: Color(0xFF28F528),
  brand: Color(0xFFFFFFFF),
  brandDim: Color(0xFFBEC0D2),
  onBrand: Color(0xFF0C0C14),
  sea: Color(0xFF466EFF),
  danger: Color(0xFFF87171),
  warning: Color(0xFFFBBF24),
  success: Color(0xFF4ADE80),
);

/// Windows Vista / Media Player 11: deep navy glass, Aero blue, Vista green.
const vistaPalette = Palette(
  brightness: Brightness.dark,
  background: Color(0xFF0B1628),
  surface: Color(0xFF182A46),
  surface2: Color(0xFF2C4468),
  border: Color(0xFF46628A),
  muted: Color(0xFF809CC2),
  mutedLight: Color(0xFFA4BEDE),
  textSecondary: Color(0xFFC6D8EE),
  text: Color(0xFFFFFFFF),
  brand: Color(0xFF389CF5),
  brandDim: Color(0xFF1870D0),
  onBrand: Color(0xFF04101F),
  sea: Color(0xFF6ED68A),
  danger: Color(0xFFF87171),
  warning: Color(0xFFFBBF24),
  success: Color(0xFF4ADE80),
);

/// The active palette, read through static getters so call sites stay short
/// (`AppColors.muted`). Not const: switching the theme changes [current] and
/// then rebuilds the whole widget tree (see `rebuildAll` in app.dart).
class AppColors {
  AppColors._();

  static Palette current = darkPalette;

  static Palette forBrightness(Brightness b) =>
      b == Brightness.light ? lightPalette : darkPalette;

  static Color get background => current.background;
  static Color get surface => current.surface;
  static Color get surface2 => current.surface2;
  static Color get border => current.border;
  static Color get muted => current.muted;
  static Color get mutedLight => current.mutedLight;
  static Color get textSecondary => current.textSecondary;
  static Color get text => current.text;
  static Color get brand => current.brand;
  static Color get brandDim => current.brandDim;
  static Color get onBrand => current.onBrand;
  static Color get sea => current.sea;
  static Color get danger => current.danger;
  static Color get warning => current.warning;
  static Color get success => current.success;
}
