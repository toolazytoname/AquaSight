import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _clearKey = Key('timeline-clear-filters');
const _searchKey = Key('timeline-search');
const _normalHighScoreKey = Key('event-card-same-day-normal-high-score');

void main() {
  testWidgets(
      'timeline-clear-filters is full-row 48px; tap left edge clears search',
      (tester) async {
    await _pumpApp(tester);

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();

    expect(find.byKey(_clearKey), findsOneWidget);
    expect(tester.widget(find.byKey(_clearKey)), isA<TextButton>());

    final size = tester.getSize(find.byKey(_clearKey));
    expect(size.height, greaterThanOrEqualTo(48));
    expect(size.width, greaterThanOrEqualTo(300));

    expect(find.byTooltip('清除筛选'), findsOneWidget);
    expect(find.bySemanticsLabel('清除筛选'), findsNothing);

    final rect = tester.getRect(find.byKey(_clearKey));
    await tester.tapAt(Offset(rect.left + 8, rect.center.dy));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_normalHighScoreKey), findsOneWidget);
    expect(find.byKey(_clearKey), findsNothing);
  });
}

Future<void> _pumpApp(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
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
