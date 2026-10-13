import 'package:flutter/material.dart';

/// Gives every vertical list in the app a draggable scrollbar.
///
/// Material only shows scrollbars on desktop by default; on a phone, getting
/// through a list of thousands of songs meant flicking again and again. The
/// thumb appears while scrolling and can be grabbed and dragged to jump
/// through the list.
class AppScrollBehavior extends MaterialScrollBehavior {
  const AppScrollBehavior();

  @override
  Widget buildScrollbar(
      BuildContext context, Widget child, ScrollableDetails details) {
    final vertical = details.direction == AxisDirection.down ||
        details.direction == AxisDirection.up;
    if (!vertical) return child;
    return Scrollbar(
      controller: details.controller,
      interactive: true,
      thickness: 10,
      radius: const Radius.circular(5),
      child: child,
    );
  }
}
