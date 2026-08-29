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

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _unknownTimeKey = Key('event-card-unknown-date-time');
const _breakingStamp = '2026-08-25T16:45:00.000Z';

final _clock = beijingClockLabel(DateTime.parse(_breakingStamp));

void main() {
  testWidgets(
      'parsed stamp: time tooltip is beijing clock; no Semantics label; 未知 stays bare',
      (tester) async {
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

    expect(_timeText(tester, _breakingTimeKey), '9小时前');
    expect(
      find.descendant(
        of: find.byTooltip(_clock),
        matching: find.byKey(_breakingTimeKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel(_clock), findsNothing);
    expect(_tooltipSemantics(_clock), findsAtLeastNWidgets(1));

    expect(_timeText(tester, _unknownTimeKey), '未知');
    expect(
      find.ancestor(
        of: find.byKey(_unknownTimeKey),
        matching: find.byType(Tooltip),
      ),
      findsNothing,
    );
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
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
