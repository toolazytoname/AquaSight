import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/timeline_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
const _baiduKey = Key('source-filter-baidu');
const _toggleKey = Key('unread-only-toggle');
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

const _sortedFixtureSources = [
  '36kr',
  'baidu',
  'bbc',
  'hn',
  'ithome',
  'v2ex',
  'weibo',
];

void main() {
  testWidgets('default is 全部 and every fixture card is visible', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(find.text('全部'), findsOneWidget);
    for (final name in _sortedFixtureSources) {
      expect(find.byKey(Key('source-filter-$name')), findsOneWidget);
      expect(_chip(tester, Key('source-filter-$name')).selected, isFalse);
    }
    expect(
      sourceFilterNames(EventsFile.parse(loadFixtureBytes()).items),
      _sortedFixtureSources,
    );
    _expectAllFixtureCards();
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('weibo keeps the clustered breaking card and hides other sources',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await _tapChip(tester, _weiboKey);

    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsNothing);
    expect(find.byKey(const Key('event-card-seen-only')), findsNothing);
    expect(find.byKey(const Key('event-card-missing-title-zh')), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);
    expect(find.byKey(const Key('day-group-2026-08-26')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsNothing);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('baidu matches sourceChips on the clustered weibo+baidu card',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await _tapChip(tester, _baiduKey);

    expect(_chip(tester, _baiduKey).selected, isTrue);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsNothing);
  });

  testWidgets('tap 全部 restores every fixture card', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await _tapChip(tester, _weiboKey);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);

    await _tapChip(tester, _allKey);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    _expectAllFixtureCards();
    expect(find.byKey(const Key('day-group-2026-08-26')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsOneWidget);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsOneWidget);
  });

  testWidgets('weibo AND unread-only hides the pre-seeded breaking card',
      (tester) async {
    final store = ReadStore.memory({'same-day-breaking'});
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: store,
      ),
    );
    await tester.pumpAndSettle();

    await _tapChip(tester, _weiboKey);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_breakingReadKey), findsOneWidget);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('refresh that drops weibo keeps the filter and shows 暂无该来源',
      (tester) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        final raw = loadFixtureJson();
        if (loads == 1) return jsonEncode(raw);
        raw['items'] = _itemsWithoutWeibo(raw);
        return jsonEncode(raw);
      },
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(_weiboKey), findsOneWidget);

    await _tapChip(tester, _weiboKey);
    expect(find.byKey(_breakingKey), findsOneWidget);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    await tester.pumpAndSettle();
    await refresh;

    expect(loads, 2);
    expect(find.byKey(_weiboKey), findsNothing);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无该来源'), findsOneWidget);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
    expect(find.text('加载失败'), findsNothing);

    await _tapChip(tester, _allKey);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_weiboKey), findsNothing);
  });

  testWidgets('new AquaApp resets source to 全部; unread toggle persists',
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
      ),
    );
    await tester.pumpAndSettle();

    await _tapChip(tester, _weiboKey);
    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);

    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: store,
        unreadOnlyStore: unreadOnly,
      ),
    );
    await tester.pumpAndSettle();

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
  });

  testWidgets('source-empty feed keeps 暂无事件 even after unread-only',
      (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_allKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.text('暂无该来源'), findsNothing);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });
}

Future<void> _tapChip(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
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

List<Map<String, dynamic>> _itemsWithoutWeibo(Map<String, dynamic> raw) {
  return [
    for (final row in raw['items'] as List)
      if (row is Map)
        _stripWeibo(Map<String, dynamic>.from(row)),
  ];
}

Map<String, dynamic> _stripWeibo(Map<String, dynamic> item) {
  if (item['source'] == 'weibo') {
    item['source'] = 'ithome';
  }
  final sources = item['sources'];
  if (sources is List) {
    item['sources'] = [
      for (final source in sources)
        if (source is Map && source['source'] != 'weibo') source,
    ];
  }
  return item;
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
