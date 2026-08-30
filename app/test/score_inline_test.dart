import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _highScoreTime = Key('event-card-same-day-normal-high-score-time');
const _highScoreScore = Key('event-card-same-day-normal-high-score-score');
const _breakingTime = Key('event-card-same-day-breaking-time');
const _breakingScore = Key('event-card-same-day-breaking-score');
const _unknownCard = Key('event-card-unknown-date');
const _unknownScore = Key('event-card-unknown-date-score');

void main() {
  testWidgets('score sits on the time row for scored cards; unknown has none',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_highScoreScore), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(_highScoreScore), matching: find.text('分数 99')),
      findsOneWidget,
    );
    _expectSameTimeRow(time: _highScoreTime, score: _highScoreScore);

    expect(find.byKey(_breakingScore), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(_breakingScore), matching: find.text('分数 2')),
      findsOneWidget,
    );
    _expectSameTimeRow(time: _breakingTime, score: _breakingScore);

    expect(find.byKey(_unknownScore), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(_unknownCard),
        matching: find.byWidgetPredicate(
          (widget) => widget is Text && (widget.data?.startsWith('分数') ?? false),
        ),
      ),
      findsNothing,
    );
  });
}

void _expectSameTimeRow({
  required Key time,
  required Key score,
}) {
  final timeFinder = find.byKey(time);
  final scoreFinder = find.byKey(score);
  expect(scoreFinder, findsOneWidget);
  final row = find.ancestor(of: timeFinder, matching: find.byType(Row)).first;
  expect(find.descendant(of: row, matching: scoreFinder), findsOneWidget);
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
