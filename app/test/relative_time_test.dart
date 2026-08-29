import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _seenOnlyTimeKey = Key('event-card-seen-only-time');
const _unknownTimeKey = Key('event-card-unknown-date-time');

void main() {
  group('relativeTimeLabel', () {
    test('null (missing or parse fail) is 未知', () {
      expect(relativeTimeLabel(null, _fixedNow), '未知');
    });

    test('30 seconds ago is 刚刚', () {
      final when = _fixedNow.subtract(const Duration(seconds: 30));
      expect(relativeTimeLabel(when, _fixedNow), '刚刚');
    });

    test('5 minutes ago is 5分钟前', () {
      final when = _fixedNow.subtract(const Duration(minutes: 5));
      expect(relativeTimeLabel(when, _fixedNow), '5分钟前');
    });

    test('future 1 hour is 刚刚', () {
      final when = _fixedNow.add(const Duration(hours: 1));
      expect(relativeTimeLabel(when, _fixedNow), '刚刚');
    });

    test('breaking fixture stamp is 9小时前', () {
      final when = parseAsUtc('2026-08-25T16:45:00.000Z');
      expect(relativeTimeLabel(when, _fixedNow), '9小时前');
    });

    test('seen-only fixture stamp is 2天前', () {
      final when = parseAsUtc('2026-08-23T20:00:00.000Z');
      expect(relativeTimeLabel(when, _fixedNow), '2天前');
    });
  });

  testWidgets(
      'fixture cards: 破圈 9小时前, seen-only 2天前, unknown-date 未知',
      (tester) async {
    await _pumpFixture(tester);

    expect(_timeText(tester, _breakingTimeKey), '9小时前');
    expect(find.text('9小时前更新'), findsNothing);
    expect(_timeText(tester, _seenOnlyTimeKey), '2天前');
    expect(_timeText(tester, _unknownTimeKey), '未知');
    expect(find.byKey(_unknownTimeKey), findsOneWidget);
  });

  testWidgets('time sits under the title and above chips', (tester) async {
    await _pumpFixture(tester);

    final title = tester.getBottomLeft(find.text('同日破圈'));
    final time = tester.getTopLeft(find.byKey(_breakingTimeKey));
    final chip = tester.getTopLeft(
      find.descendant(
        of: find.byKey(const Key('event-card-same-day-breaking')),
        matching: find.text('weibo'),
      ),
    );
    expect(time.dy, greaterThan(title.dy));
    expect(time.dy, lessThan(chip.dy));
  });

  testWidgets('time uses onSurfaceVariant', (tester) async {
    await _pumpFixture(tester);

    final scheme = Theme.of(
      tester.element(find.byKey(_breakingTimeKey)),
    ).colorScheme;
    final text = tester.widget<Text>(find.byKey(_breakingTimeKey));
    expect(text.style?.color, scheme.onSurfaceVariant);
  });
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _fixedNow,
    ),
  );
  await tester.pumpAndSettle();
}

String _timeText(WidgetTester tester, Key key) {
  return tester.widget<Text>(find.byKey(key)).data!;
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
