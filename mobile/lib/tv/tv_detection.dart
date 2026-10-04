import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether this is an Android TV / Google TV device (the system declares the "leanback" feature).
Future<bool> detectAndroidTv() async {
  if (defaultTargetPlatform != TargetPlatform.android) return false;
  try {
    final info = await DeviceInfoPlugin().androidInfo;
    return info.systemFeatures.contains('android.software.leanback');
  } catch (_) {
    return false;
  }
}

/// Set once in main(); the TV gets its own interface (see lib/tv).
final isTvProvider = Provider<bool>((ref) => false);
