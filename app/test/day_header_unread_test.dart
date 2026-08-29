import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _now = DateTime.parse('2026-08-26T02:00:00.000Z');

const _todayLabel = '2026-08-26';
const _earlierLabel = '2026-08-24';
const _todayGroupKey = Key('day-group-$_todayLabel');
const _todayUnreadKey = Key('day-group-$_todayLabel-unread');
const _earlierUnreadKey = Key('day-group-$_earlierLabel-unread');
final _unknownUnreadKey = Key('day-group-$unknownDateLabel-unread');
const _toggleKey = Key('unread-only-toggle');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  final groupIds = _fixtureGroupIds();
  final todayCount = groupIds[_todayLabel]!.length;
  final earlierCount = groupIds[_earlierLabel]!.length;
  final unknownCount = groupIds[unknownDateLabel]!.length;
  final todayIds = groupIds[_todayLabel]!;

  testWidgets(
      'fixture headers: 今天 stays one Text; unread number equals group card count',
      (tester) async {
    await _pumpFixture(tester);

    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );
    expect(_unreadNumber(tester, _todayUnreadKey), todayCount);
    expect(_unreadNumber(tester, _earlierUnreadKey), earlierCount);
    expect(_unreadNumber(tester, _unknownUnreadKey), unknownCount);
  });

  testWidgets(
      'today group all read hides that unread key; 今天 remains; other groups unchanged',
      (tester) async {
    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({...todayIds}),
    );

    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );
    expect(find.byKey(_todayUnreadKey), findsNothing);
    expect(_unreadNumber(tester, _earlierUnreadKey), earlierCount);
    expect(_unreadNumber(tester, _unknownUnreadKey), unknownCount);
  });

  testWidgets('opening one today card decrements that group unread by 1',
      (tester) async {
    final opened = <Uri>[];
    await _pumpFixture(
      tester,
      openUrl: (uri) async => opened.add(uri),
    );

    expect(_unreadNumber(tester, _todayUnreadKey), todayCount);

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, isNotEmpty);
    expect(_unreadNumber(tester, _todayUnreadKey), todayCount - 1);
    expect(_unreadNumber(tester, _earlierUnreadKey), earlierCount);
    expect(_unreadNumber(tester, _unknownUnreadKey), unknownCount);
  });

  testWidgets(
      'unread-only on: each group number equals visible cards in that group',
      (tester) async {
    await _pumpFixture(tester);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_unreadNumber(tester, _todayUnreadKey), todayCount);
    expect(_unreadNumber(tester, _earlierUnreadKey), earlierCount);
    expect(_unreadNumber(tester, _unknownUnreadKey), unknownCount);
  });
}

Map<String, List<String>> _fixtureGroupIds() {
  final file = EventsFile.parse(loadFixtureBytes());
  return {
    for (final group in groupTimeline(file))
      group.label: [for (final item in group.items) item.id],
  };
}

int _unreadNumber(WidgetTester tester, Key key) {
  return int.parse(tester.widget<Text>(find.byKey(key)).data!);
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  ReadStore? readStore,
  Future<void> Function(Uri uri)? openUrl,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl ?? _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _now,
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
