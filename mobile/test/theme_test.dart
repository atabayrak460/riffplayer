import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/app_colors.dart';
import 'package:riffplayer_mobile/theme.dart';

void main() {
  testWidgets(
      'an elevated button sized to its content has room on both sides of its '
      'label (the Play button used to hug it)', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(AppColors.current),
        home: Scaffold(
          body: Row(
            children: [
              ElevatedButton.icon(
                key: const ValueKey('play'),
                onPressed: () {},
                icon: const Icon(Icons.play_arrow, size: 18),
                label: const Text('Play'),
              ),
            ],
          ),
        ),
      ),
    );

    final button = tester.getRect(find.byKey(const ValueKey('play')));
    final icon = tester.getRect(find.byIcon(Icons.play_arrow));
    final label = tester.getRect(find.text('Play'));

    expect(icon.left - button.left, greaterThanOrEqualTo(24));
    expect(button.right - label.right, greaterThanOrEqualTo(24));
  });
}
