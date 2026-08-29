import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _clearKey = Key('timeline-clear-filters');
const _showAllKey = Key('timeline-empty-show-all');
const _emptyKey = Key('timeline-empty');
const _searchKey = Key('timeline-search');
const _breakingKey = Key('event-card-same-day-breaking');
const _normalHighScoreKey = Key('event-card-same-day-normal-high-score');

void main() {
  testWidgets(
      'search 破圈: bar 清除筛选 is TextButton; tap clears query and restores cards',
      (tester) async {
    await _pumpApp(tester);

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_clearKey), findsOneWidget);
    expect(tester.widget(find.byKey(_clearKey)), isA<TextButton>());
    expect(
      find.descendant(
        of: find.byKey(_clearKey),
        matching: find.text('清除筛选'),
      ),
      findsOneWidget,
    );
    expect(find.byTooltip('清除筛选'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('清除筛选'),
        matching: find.byKey(_clearKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('清除筛选'), findsNothing);
    expect(_tooltipSemantics('清除筛选'), findsOne);

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_normalHighScoreKey), findsOneWidget);
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.byTooltip('清除筛选'), findsNothing);
  });

  testWidgets('no filters: timeline-clear-filters is absent', (tester) async {
    await _pumpApp(tester);

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_normalHighScoreKey), findsOneWidget);
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.byTooltip('清除筛选'), findsNothing);
    expect(find.bySemanticsLabel('清除筛选'), findsNothing);
  });

  testWidgets(
      'zzzz-nomatch: empty-state 查看全部 stays; bar 清除筛选 is gone',
      (tester) async {
    await _pumpApp(tester);

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_showAllKey),
        matching: find.text('查看全部'),
      ),
      findsOneWidget,
    );
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.byTooltip('清除筛选'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('清除筛选'),
        matching: find.byKey(_showAllKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('清除筛选'), findsNothing);
    expect(_tooltipSemantics('清除筛选'), findsOne);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
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
