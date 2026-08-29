import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _seenOnlyTimeKey = Key('event-card-seen-only-time');
const _unknownTimeKey = Key('event-card-unknown-date-time');

void main() {
  testWidgets(
      'card relative times expose Beijing clock tooltip; 未知 does not',
      (tester) async {
    await _pumpFixture(tester);

    expect(_timeText(tester, _breakingTimeKey), '9小时前');
    expect(
      find.descendant(
        of: find.byTooltip('2026-08-26 00:45'),
        matching: find.byKey(_breakingTimeKey),
      ),
      findsOneWidget,
    );

    expect(_timeText(tester, _seenOnlyTimeKey), '2天前');
    expect(
      find.descendant(
        of: find.byTooltip('2026-08-24 04:00'),
        matching: find.byKey(_seenOnlyTimeKey),
      ),
      findsOneWidget,
    );

    expect(_timeText(tester, _unknownTimeKey), '未知');
    expect(
      find.ancestor(
        of: find.byKey(_unknownTimeKey),
        matching: find.byType(Tooltip),
      ),
      findsNothing,
    );
  });

  testWidgets('time stays under the title and above chips', (tester) async {
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
