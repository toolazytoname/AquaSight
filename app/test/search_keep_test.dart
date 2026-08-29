import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _clearKey = Key('timeline-search-clear');
const _showAllKey = Key('timeline-empty-show-all');
const _emptyKey = Key('timeline-empty');
const _breakingKey = Key('event-card-same-day-breaking');
const _englishKey = Key('event-card-missing-title-zh');

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
      'pumpWidget same AquaApp keeps query, filter, and 没有匹配',
      (tester) async {
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());
    final readStore = ReadStore.memory();
    final unreadOnly = UnreadOnlyStore.memory();
    final scrollOffset = ScrollOffsetStore.memory();
    final sourceFilter = SourceFilterStore.memory();

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
      scrollOffset: scrollOffset,
      sourceFilter: sourceFilter,
    );

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, 'zzzz-nomatch');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
      scrollOffset: scrollOffset,
      sourceFilter: sourceFilter,
      now: () => DateTime.utc(2026, 8, 29),
    );

    expect(_searchField(tester).controller!.text, 'zzzz-nomatch');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(_breakingKey), findsNothing);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }
  });

  testWidgets('timeline-search-clear empties the query', (tester) async {
    await _pumpApp(tester);

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();
    expect(find.byKey(_clearKey), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('查看全部 still clears a filtered-empty search', (tester) async {
    await _pumpApp(tester);

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(find.text('查看全部'), findsOneWidget);

    await tester.tap(find.byKey(_showAllKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_englishKey), findsOneWidget);
  });

  testWidgets('new AquaApp after SizedBox starts with empty search',
      (tester) async {
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());
    final readStore = ReadStore.memory();
    final unreadOnly = UnreadOnlyStore.memory();
    final scrollOffset = ScrollOffsetStore.memory();
    final sourceFilter = SourceFilterStore.memory();

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
      scrollOffset: scrollOffset,
      sourceFilter: sourceFilter,
    );

    await tester.enterText(find.byKey(_searchKey), 'english');
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, 'english');
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);

    await tester.pumpWidget(const SizedBox());
    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
      scrollOffset: scrollOffset,
      sourceFilter: sourceFilter,
    );

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.text('搜索标题'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);
  });
}

Future<void> _pumpApp(
  WidgetTester tester, {
  EventsRepository? repository,
  ReadStore? readStore,
  UnreadOnlyStore? unreadOnly,
  ScrollOffsetStore? scrollOffset,
  SourceFilterStore? sourceFilter,
  DateTime Function()? now,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository:
          repository ?? EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: unreadOnly ?? UnreadOnlyStore.memory(),
      scrollOffsetStore: scrollOffset ?? ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilter ?? SourceFilterStore.memory(),
      now: now ?? DateTime.now,
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
