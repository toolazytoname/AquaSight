import 'package:aquasight/timeline/grouping.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('beijingClockLabel', () {
    test('2026-08-26T01:50:00.000Z is 2026-08-26 09:50', () {
      final utc = parseAsUtc('2026-08-26T01:50:00.000Z')!;
      expect(beijingClockLabel(utc), '2026-08-26 09:50');
    });

    test('cross-day 2026-08-25T16:45:00.000Z is 2026-08-26 00:45', () {
      final utc = parseAsUtc('2026-08-25T16:45:00.000Z')!;
      expect(beijingClockLabel(utc), '2026-08-26 00:45');
    });
  });
}
