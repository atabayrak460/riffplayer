import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/types.dart';
import '../providers/radio_provider.dart';
import 'snackbar.dart';

/// Starts a radio and tells the user if it could not be built.
Future<void> startRadio(BuildContext context, WidgetRef ref, RadioSeed seed,
    {Song? firstSong}) async {
  showSnackBar(context, 'Starting radio…');
  final problem =
      await ref.read(radioProvider.notifier).start(seed, firstSong: firstSong);
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).hideCurrentSnackBar();
  if (problem != null) showFailureSnackBar(context, problem);
}

/// A "Radio" button that sits next to Play on album / playlist pages.
class RadioButton extends ConsumerWidget {
  const RadioButton(
      {super.key,
      required this.seed,
      this.label = 'Radio',
      this.enabled = true});

  final RadioSeed seed;
  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) => TextButton.icon(
        onPressed: enabled ? () => startRadio(context, ref, seed) : null,
        icon: const Icon(Icons.radio, size: 18),
        label: Text(label),
      );
}
