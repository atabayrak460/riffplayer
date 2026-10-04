import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/utils/credits.dart';

void main() {
  test('nothing in, nothing out', () {
    expect(creditRows(const {}), isEmpty);
  });

  test('joins lists, keeps a fixed order and skips empties', () {
    expect(
      creditRows({
        'isrc': ['X1'],
        'composers': ['A', 'B'],
        'producers': <String>[],
        'copyright': '2020 Label',
        'bpm': 120,
        'originalYear': 1999,
      }),
      [
        ('Composer', 'A, B'),
        ('ISRC', 'X1'),
        ('Original year', '1999'),
        ('BPM', '120'),
        ('Copyright', '2020 Label'),
      ],
    );
  });
}
