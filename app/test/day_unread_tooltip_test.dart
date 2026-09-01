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
final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _todayUnreadKey = Key('day-group-2026-08-26-unread');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets(
      'today unread number has ancestor Tooltip 未读; text is that day count',
      (tester) async {
    _setDefaultSurface(tester);
    await _pump(tester);

    expect(find.byKey(_todayUnreadKey), findsOneWidget);
    expect(tester.widget(find.byKey(_todayUnreadKey)), isA<Text>());
    final unread = int.parse(
      tester.widget<Text>(find.byKey(_todayUnreadKey)).data!,
    );
    expect(unread, greaterThan(0));
    expect(unread, _todayUnreadCount());
    expect(
      tester
          .widget<Tooltip>(
            find.ancestor(
              of: find.byKey(_todayUnreadKey),
              matching: find.byType(Tooltip),
            ),
          )
          .message,
      '未读',
    );
  });

  testWidgets('all six cards read: no day-group-*-unread widgets',
      (tester) async {
    _setDefaultSurface(tester);
    await _pump(tester, readStore: ReadStore.memory({..._allFixtureIds}));

    expect(_dayUnreadFinder, findsNothing);
  });
}

Finder get _dayUnreadFinder {
  return find.byWidgetPredicate((widget) {
    final key = widget.key;
    if (key is! ValueKey<String>) return false;
    return key.value.startsWith('day-group-') && key.value.endsWith('-unread');
  });
}

int _todayUnreadCount() {
  final file = EventsFile.parse(loadFixtureBytes());
  return groupTimeline(file)
      .firstWhere((group) => group.label == '2026-08-26')
      .items
      .length;
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pump(
  WidgetTester tester, {
  ReadStore? readStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _fixedNow,
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
