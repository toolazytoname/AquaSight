import 'package:aquasight/models/event.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  late EventsFile file;

  setUp(() {
    file = EventsFile.parse(loadFixtureBytes());
  });

  test('groups by Beijing date using publishedAt over seenAt', () {
    final groups = groupTimeline(file);
    final labels = groups.map((g) => g.label).toList();

    expect(labels, ['2026-08-26', '2026-08-24', unknownDateLabel]);

    final nextDay = groups.firstWhere((g) => g.label == '2026-08-26');
    expect(nextDay.items.map((e) => e.id), contains('cross-midnight'));

    final earlier = groups.firstWhere((g) => g.label == '2026-08-24');
    expect(earlier.items.map((e) => e.id), contains('seen-only'));
  });

  test('missing timestamps land in 未知日期 when file updatedAt is absent', () {
    final groups = groupTimeline(file);
    final unknown = groups.firstWhere((g) => g.label == unknownDateLabel);
    expect(unknown.items.map((e) => e.id), ['unknown-date']);
  });

  test('file-level updatedAt groups cards that lack item timestamps', () {
    final raw = loadFixtureJson();
    raw['updatedAt'] = '2026-08-20T16:30:00.000Z';
    final withFileStamp = EventsFile.fromJson(raw);
    final groups = groupTimeline(withFileStamp);

    expect(groups.map((g) => g.label), isNot(contains(unknownDateLabel)));
    final fromFile = groups.firstWhere((g) => g.label == '2026-08-21');
    expect(fromFile.items.map((e) => e.id), ['unknown-date']);
  });

  test('breaking cards come first within a day, then score desc', () {
    final groups = groupTimeline(file);
    final day = groups.firstWhere((g) => g.label == '2026-08-26');
    expect(day.items.map((e) => e.id).toList(), [
      'same-day-breaking',
      'same-day-normal-high-score',
      'cross-midnight',
    ]);
    expect(day.items.first.isBreaking, isTrue);
    expect(day.items[1].score, 99);
    expect(day.items[2].score, 5);
  });

  test('titleZh falls back to title when missing or empty', () {
    final byId = {for (final item in file.items) item.id: item};
    expect(byId['cross-midnight']!.displayTitle, '北京已是次日');
    expect(byId['same-day-breaking']!.displayTitle, '同日破圈');
    expect(byId['missing-title-zh']!.displayTitle, 'English-only title stays English');
    expect(byId['same-day-normal-high-score']!.displayTitle, 'High score normal same Beijing day');
  });

  test('empty items produces no groups', () {
    final raw = loadFixtureJson();
    raw['items'] = [];
    final empty = EventsFile.fromJson(raw);
    expect(empty.items, isEmpty);
    expect(groupTimeline(empty), isEmpty);
  });

  test('UTC+8 midnight boundary is not grouped by UTC date', () {
    expect(beijingCalendarDate('2026-08-25T16:00:00.000Z'), '2026-08-26');
    expect(beijingCalendarDate('2026-08-25T15:59:00.000Z'), '2026-08-25');
  });
}
