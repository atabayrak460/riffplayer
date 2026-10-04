import 'package:flutter/material.dart';

import '../app_colors.dart';

/// App-bar button for the lossless / Hi-Res filter (All Songs and Albums).
/// [value] is null (no filter), 'lossless' or 'hires'.
class QualityFilterMenu extends StatelessWidget {
  const QualityFilterMenu(
      {super.key, required this.value, required this.onChanged});

  final String? value;
  final ValueChanged<String?> onChanged;

  // PopupMenuButton never reports a null value as a selection (null means
  // "dismissed"), so "no filter" travels as the string 'all'.
  static const _all = 'all';

  static const _options = [
    (_all, 'All quality'),
    ('lossless', 'Lossless'),
    ('hires', 'Hi-Res only'),
  ];

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Filter by audio quality',
      icon: Icon(Icons.high_quality,
          color: value == null ? null : AppColors.brand),
      initialValue: value ?? _all,
      onSelected: (v) => onChanged(v == _all ? null : v),
      itemBuilder: (_) => [
        for (final o in _options)
          PopupMenuItem<String>(value: o.$1, child: Text(o.$2)),
      ],
    );
  }
}
