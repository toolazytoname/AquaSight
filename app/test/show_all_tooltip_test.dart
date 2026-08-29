import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _showAllKey = Key('timeline-empty-show-all');
const _emptyKey = Key('timeline-empty');
const _searchKey = Key('timeline-search');
const _toggleKey = Key('unread-only-toggle');
const _allKey = Key('source-filter-all');

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
      'search with no match: 查看全部 has 清除筛选 tooltip and semantics',
      (tester) async {
    await _pumpApp(tester);

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byTooltip('清除筛选'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('清除筛选'),
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is Semantics && widget.properties.label == '清除筛选',
        ),
      ),
      findsOneWidget,
    );
    expect(tester.widget(find.byKey(_showAllKey)), isA<TextButton>());
    expect(
      find.descendant(
        of: find.byKey(_showAllKey),
        matching: find.text('查看全部'),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
      'tap 查看全部 clears filters and restores cards without openUrl',
      (tester) async {
    final opened = <Uri>[];
    final unreadOnly = UnreadOnlyStore.memory();
    final sourceFilter = SourceFilterStore.memory();
    await _pumpApp(
      tester,
      openUrl: (uri) async => opened.add(uri),
      unreadOnly: unreadOnly,
      sourceFilter: sourceFilter,
    );

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byTooltip('清除筛选'), findsOneWidget);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }

    await tester.tap(find.byKey(_showAllKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(sourceFilter.value, isNull);
    _expectAllFixtureCards();
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
    expect(find.byTooltip('清除筛选'), findsNothing);
    expect(opened, isEmpty);
  });
}

Future<void> _pumpApp(
  WidgetTester tester, {
  EventsRepository? repository,
  ReadStore? readStore,
  UnreadOnlyStore? unreadOnly,
  SourceFilterStore? sourceFilter,
  Future<void> Function(Uri uri)? openUrl,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository:
          repository ?? EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl ?? _forbidLaunch,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: unreadOnly ?? UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilter ?? SourceFilterStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

void _expectAllFixtureCards() {
  for (final id in _allFixtureIds) {
    expect(find.byKey(Key('event-card-$id')), findsOneWidget);
  }
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
