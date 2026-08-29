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

const _emptyKey = Key('timeline-empty');
const _refreshKey = Key('timeline-empty-refresh');
const _showAllKey = Key('timeline-empty-show-all');
const _searchKey = Key('timeline-search');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _breakingKey = Key('event-card-same-day-breaking');
const _updatedA = '2026-08-26T01:00:00.000Z';
const _updatedB = '2026-08-26T03:00:00.000Z';

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
      'true-empty first load shows 暂无事件 and 刷新; no 查看全部 or cards',
      (tester) async {
    await tester.pumpWidget(
      _app(
        EventsRepository.fromJsonString(_emptyFixture(_updatedA)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.byKey(_refreshKey), findsOneWidget);
    expect(tester.widget(find.byKey(_refreshKey)), isA<FilledButton>());
    expect(
      find.descendant(
        of: find.byKey(_refreshKey),
        matching: find.text('刷新'),
      ),
      findsOneWidget,
    );
    expect(find.byTooltip('重新加载'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('重新加载'),
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is Semantics && widget.properties.label == '重新加载',
        ),
      ),
      findsOneWidget,
    );
    expect(find.byKey(_showAllKey), findsNothing);
    expect(find.text('查看全部'), findsNothing);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }
  });

  testWidgets(
      'tap timeline-empty-refresh loads cards and shows 已更新',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return _emptyFixture(_updatedA);
            return _fixtureWithUpdatedAt(_updatedB);
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.byKey(_refreshKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    await tester.tap(find.byKey(_refreshKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_breakingKey), findsOneWidget);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsOneWidget);
    }
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新'), findsOneWidget);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(_refreshKey), findsNothing);
    expect(find.text('刷新'), findsNothing);
  });

  testWidgets(
      'filtered-empty search shows only 查看全部; no timeline-empty-refresh',
      (tester) async {
    await tester.pumpWidget(
      _app(EventsRepository.fromJsonString(loadFixtureBytes())),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.text('查看全部'), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(find.byKey(_refreshKey), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(_emptyKey),
        matching: find.text('刷新'),
      ),
      findsNothing,
    );
    expect(find.text('暂无事件'), findsNothing);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }
  });
}

Widget _app(EventsRepository repository) {
  return AquaApp(
    repository: repository,
    openUrl: _forbidLaunch,
    shareEvent: _forbidShare,
    readStore: ReadStore.memory(),
    unreadOnlyStore: UnreadOnlyStore.memory(),
    scrollOffsetStore: ScrollOffsetStore.memory(),
    sourceFilterStore: SourceFilterStore.memory(),
  );
}

String _emptyFixture(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  raw['items'] = [];
  return jsonEncode(raw);
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  return jsonEncode(raw);
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
