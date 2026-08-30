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

const _showAllKey = Key('timeline-empty-show-all');
const _emptyKey = Key('timeline-empty');
const _searchKey = Key('timeline-search');
const _breakingKey = Key('event-card-same-day-breaking');
const _normalHighScoreKey = Key('event-card-same-day-normal-high-score');

void main() {
  testWidgets(
      'zzzz-nomatch: timeline-empty-show-all is 48×48 TextButton; tap restores cards',
      (tester) async {
    await _pumpApp(tester);

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(tester.widget(find.byKey(_showAllKey)), isA<TextButton>());
    expect(
      find.descendant(
        of: find.byKey(_showAllKey),
        matching: find.text('查看全部'),
      ),
      findsOneWidget,
    );

    final size = tester.getSize(find.byKey(_showAllKey));
    expect(size.width, greaterThanOrEqualTo(48));
    expect(size.height, greaterThanOrEqualTo(48));

    expect(find.byTooltip('清除筛选'), findsOneWidget);

    await tester.tap(find.byKey(_showAllKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_normalHighScoreKey), findsOneWidget);
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
