import 'dart:convert';

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

const _searchKey = Key('timeline-search');
const _toggleKey = Key('unread-only-toggle');
const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
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
  testWidgets('default search is empty and every fixture card is visible',
      (tester) async {
    await _pumpFixture(tester);

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.text('搜索标题'), findsOneWidget);
    expect(find.byKey(_searchKey), findsOneWidget);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_toggle(tester).value, isFalse);
    _expectAllFixtureCards();
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('english and ENGLISH match displayTitle case-insensitively',
      (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, 'english');
    _expectEnglishOnlyHit();

    await _typeSearch(tester, 'ENGLISH');
    _expectEnglishOnlyHit();
  });

  testWidgets('破圈 matches titleZh displayTitle and hides other days',
      (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, '破圈');

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.text('English-only title stays English'), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('day-group-2026-08-26')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsNothing);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('zzzz-nomatch with unread off shows 没有匹配, not error',
      (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, 'zzzz-nomatch');

    expect(_toggle(tester).value, isFalse);
    expect(find.byKey(_searchKey), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
    expect(find.text('加载失败'), findsNothing);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }
  });

  testWidgets('unread on plus 破圈 with breaking already read shows 暂无未读',
      (tester) async {
    await _pumpFixture(
      tester,
      store: ReadStore.memory({'same-day-breaking'}),
    );

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    await _typeSearch(tester, '破圈');

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(_searchKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('clear search restores cards for the current source and unread',
      (tester) async {
    await _pumpFixture(
      tester,
      store: ReadStore.memory({'same-day-breaking'}),
    );

    await _tapChip(tester, _weiboKey);
    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);

    await _typeSearch(tester, '破圈');
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);

    await _typeSearch(tester, 'zzzz-nomatch');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(_chip(tester, _weiboKey).selected, isTrue);

    await _typeSearch(tester, '');
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets('updating AquaApp on the same tree keeps search; source and unread persist',
      (tester) async {
    final store = ReadStore.memory({'same-day-breaking'});
    final unreadOnly = UnreadOnlyStore.memory();
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: store,
        unreadOnlyStore: unreadOnly,
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await _typeSearch(tester, 'english');
    await _tapChip(tester, _weiboKey);
    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, 'english');
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isTrue);

    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: store,
        unreadOnlyStore: unreadOnly,
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, 'english');
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.byKey(_englishKey), findsNothing);
  });

  testWidgets('whitespace-only query does not filter titles', (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, '   ');
    _expectAllFixtureCards();
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets('weibo AND 破圈 keeps the clustered card; english is 没有匹配',
      (tester) async {
    await _pumpFixture(tester);

    await _tapChip(tester, _weiboKey);
    await _typeSearch(tester, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);

    await _typeSearch(tester, 'english');
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.text('暂无未读'), findsNothing);
  });

  testWidgets('empty search plus source with zero hits stays 暂无该来源',
      (tester) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        final raw = loadFixtureJson();
        if (loads == 1) return jsonEncode(raw);
        raw['items'] = [
          for (final row in raw['items'] as List)
            if (row is Map && row['source'] != 'weibo')
              Map<String, dynamic>.from(row),
        ];
        return jsonEncode(raw);
      },
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    await _tapChip(tester, _weiboKey);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    await tester.pumpAndSettle();
    await refresh;

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_searchKey), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无该来源'), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('does not match reason, source name, or unused English title',
      (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, 'hard');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);

    await _typeSearch(tester, 'weibo');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);

    await _typeSearch(tester, 'Breaking');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.text('hard impact keyword'), findsNothing);
  });

  testWidgets('source-empty feed hides search and keeps 暂无事件', (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_searchKey), findsNothing);
    expect(find.byKey(_allKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('error state hides search and does not fetch HTTP',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadFallback: () async => null,
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_searchKey), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.text('加载失败'), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });
}

Future<void> _pumpFixture(WidgetTester tester, {ReadStore? store}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: store ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _typeSearch(WidgetTester tester, String query) async {
  await tester.enterText(find.byKey(_searchKey), query);
  await tester.pumpAndSettle();
}

Future<void> _tapChip(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
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

void _expectEnglishOnlyHit() {
  expect(find.byKey(_englishKey), findsOneWidget);
  expect(find.text('English-only title stays English'), findsOneWidget);
  expect(find.text('同日破圈'), findsNothing);
  expect(find.byKey(_breakingKey), findsNothing);
  expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
  expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
      findsNothing);
  expect(find.byKey(const Key('event-card-seen-only')), findsNothing);
  expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);
  expect(find.byKey(const Key('day-group-2026-08-26')), findsNothing);
  expect(find.byKey(const Key('day-group-2026-08-24')), findsOneWidget);
  expect(find.byKey(Key('day-group-$unknownDateLabel')), findsNothing);
  expect(find.byKey(const Key('timeline-empty')), findsNothing);
  expect(find.byKey(const Key('timeline-error')), findsNothing);
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
