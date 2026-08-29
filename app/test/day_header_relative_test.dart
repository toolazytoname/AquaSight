import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _todayNow = DateTime.parse('2026-08-26T02:00:00.000Z');

/// Beijing 2026-08-27 10:00.
final _tomorrowNow = DateTime.parse('2026-08-27T02:00:00.000Z');

const _todayGroupKey = Key('day-group-2026-08-26');
const _earlierGroupKey = Key('day-group-2026-08-24');
final _unknownGroupKey = Key('day-group-$unknownDateLabel');

void main() {
  group('friendlyDayLabel', () {
    test('same Beijing calendar day is 今天', () {
      expect(friendlyDayLabel('2026-08-26', _todayNow), '今天');
    });

    test('Beijing calendar yesterday is 昨天', () {
      expect(friendlyDayLabel('2026-08-25', _todayNow), '昨天');
    });

    test('earlier calendar day stays yyyy-MM-dd', () {
      expect(friendlyDayLabel('2026-08-24', _todayNow), '2026-08-24');
    });

    test('未知日期 stays 未知日期', () {
      expect(friendlyDayLabel(unknownDateLabel, _todayNow), unknownDateLabel);
    });

    test('UTC+8 midnight boundary is not 24 hours', () {
      final atMidnight = DateTime.parse('2026-08-25T16:00:00.000Z');
      expect(beijingCalendarDate('2026-08-25T16:00:00.000Z'), '2026-08-26');
      expect(friendlyDayLabel('2026-08-26', atMidnight), '今天');
      expect(friendlyDayLabel('2026-08-25', atMidnight), '昨天');

      final beforeMidnight = DateTime.parse('2026-08-25T15:59:00.000Z');
      expect(beijingCalendarDate('2026-08-25T15:59:00.000Z'), '2026-08-25');
      expect(friendlyDayLabel('2026-08-25', beforeMidnight), '今天');
      expect(friendlyDayLabel('2026-08-24', beforeMidnight), '昨天');
      expect(friendlyDayLabel('2026-08-26', beforeMidnight), '2026-08-26');
    });
  });

  testWidgets(
      'fixture headers: today is 今天 with calendar tooltip; earlier and unknown stay bare',
      (tester) async {
    await _pumpFixture(tester, now: _todayNow);

    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(_todayGroupKey),
        matching: find.text('2026-08-26'),
      ),
      findsNothing,
    );

    expect(find.byTooltip('2026-08-26'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_todayGroupKey),
        matching: find.byTooltip('2026-08-26'),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('2026-08-26'), findsNothing);
    expect(_tooltipSemantics('2026-08-26'), findsOne);

    expect(
      find.descendant(
        of: find.byKey(_earlierGroupKey),
        matching: find.text('2026-08-24'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(_earlierGroupKey),
        matching: find.text('昨天'),
      ),
      findsNothing,
    );
    expect(find.byTooltip('2026-08-24'), findsNothing);

    expect(
      find.descendant(
        of: find.byKey(_unknownGroupKey),
        matching: find.text(unknownDateLabel),
      ),
      findsOneWidget,
    );
    expect(find.byTooltip(unknownDateLabel), findsNothing);
  });

  testWidgets('Beijing next calendar day: 2026-08-26 group is 昨天',
      (tester) async {
    await _pumpFixture(tester, now: _tomorrowNow);

    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('昨天')),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(_todayGroupKey),
        matching: find.text('2026-08-26'),
      ),
      findsNothing,
    );
    expect(find.byTooltip('2026-08-26'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_todayGroupKey),
        matching: find.byTooltip('2026-08-26'),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('2026-08-26'), findsNothing);
    expect(_tooltipSemantics('2026-08-26'), findsOne);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

Future<void> _pumpFixture(WidgetTester tester, {required DateTime now}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => now,
    ),
  );
  await tester.pumpAndSettle();
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
