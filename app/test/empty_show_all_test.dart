import 'dart:convert';

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
const _weiboKey = Key('source-filter-weibo');

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
      'unread-only + all read shows 暂无未读 and 查看全部; tap restores cards',
      (tester) async {
    final unreadOnly = UnreadOnlyStore.memory();
    final sourceFilter = SourceFilterStore.memory();
    await _pumpApp(
      tester,
      readStore: ReadStore.memory({..._allFixtureIds}),
      unreadOnly: unreadOnly,
      sourceFilter: sourceFilter,
    );
    _expectAllFixtureCards();

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(find.text('查看全部'), findsOneWidget);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }

    await tester.tap(find.byKey(_showAllKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);
    expect(sourceFilter.value, isNull);
    _expectAllFixtureCards();
    expect(find.text('暂无未读'), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
  });

  testWidgets('search with no match shows 没有匹配 and 查看全部; tap clears query',
      (tester) async {
    final unreadOnly = UnreadOnlyStore.memory();
    final sourceFilter = SourceFilterStore.memory();
    await _pumpApp(
      tester,
      unreadOnly: unreadOnly,
      sourceFilter: sourceFilter,
    );

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, 'zzzz-nomatch');
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(_showAllKey), findsOneWidget);
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
  });

  testWidgets(
      'source filter to empty shows 暂无该来源 and 查看全部; tap selects 全部',
      (tester) async {
    final unreadOnly = UnreadOnlyStore.memory();
    final sourceFilter = SourceFilterStore.memory('no-such-source');
    await _pumpApp(
      tester,
      unreadOnly: unreadOnly,
      sourceFilter: sourceFilter,
    );

    expect(_chip(tester, _allKey).selected, isFalse);
    expect(sourceFilter.value, 'no-such-source');
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无该来源'), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(_showAllKey), findsOneWidget);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }

    await tester.tap(find.byKey(_showAllKey));
    await tester.pumpAndSettle();

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(sourceFilter.value, isNull);
    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);
    _expectAllFixtureCards();
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
  });

  testWidgets('one tap clears unread, search, and source together',
      (tester) async {
    final unreadOnly = UnreadOnlyStore.memory(true);
    final sourceFilter = SourceFilterStore.memory('weibo');
    await _pumpApp(
      tester,
      readStore: ReadStore.memory({..._allFixtureIds}),
      unreadOnly: unreadOnly,
      sourceFilter: sourceFilter,
    );

    expect(_toggle(tester).value, isTrue);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, 'zzzz-nomatch');
    expect(_toggle(tester).value, isTrue);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.byKey(_showAllKey), findsOneWidget);

    await tester.tap(find.byKey(_showAllKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(sourceFilter.value, isNull);
    _expectAllFixtureCards();
    expect(find.text('暂无未读'), findsNothing);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
  });

  testWidgets('file-empty items show 暂无事件 without 查看全部', (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await _pumpApp(
      tester,
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      unreadOnly: UnreadOnlyStore.memory(),
      sourceFilter: SourceFilterStore.memory(),
    );

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
    expect(find.text('查看全部'), findsNothing);
    expect(find.byKey(_searchKey), findsNothing);
    expect(find.byKey(_allKey), findsNothing);
  });
}

Future<void> _pumpApp(
  WidgetTester tester, {
  EventsRepository? repository,
  ReadStore? readStore,
  required UnreadOnlyStore unreadOnly,
  required SourceFilterStore sourceFilter,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository:
          repository ?? EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: unreadOnly,
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilter,
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
