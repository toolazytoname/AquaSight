import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _errorKey = Key('timeline-error');
const _errorRetryKey = Key('timeline-error-retry');
const _emptyKey = Key('timeline-empty');
const _refreshKey = Key('timeline-empty-refresh');
const _showAllKey = Key('timeline-empty-show-all');
const _searchKey = Key('timeline-search');
const _breakingKey = Key('event-card-same-day-breaking');
const _updatedA = '2026-08-26T01:00:00.000Z';

void main() {
  testWidgets(
      'error page: timeline-error-retry tooltip is 重新加载; tap runs a second load',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) throw EventsLoadException('网络不可用');
            return loadFixtureBytes();
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_errorRetryKey), findsOneWidget);
    expect(tester.widget(find.byKey(_errorRetryKey)), isA<FilledButton>());
    expect(
      find.descendant(
        of: find.byKey(_errorRetryKey),
        matching: find.text('重试'),
      ),
      findsOneWidget,
    );
    expect(find.byTooltip('重新加载'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('重新加载'),
        matching: find.byKey(_errorRetryKey),
      ),
      findsOneWidget,
    );
    expect(loads, 1);

    await tester.tap(find.byKey(_errorRetryKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_errorKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets(
      'true-empty list: timeline-empty-refresh tooltip 重新加载; semantics label once',
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
        matching: find.byKey(_refreshKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('重新加载'), findsOneWidget);
  });

  testWidgets(
      'search zzzz-nomatch: timeline-empty-show-all tooltip 清除筛选; semantics label once',
      (tester) async {
    await tester.pumpWidget(
      _app(EventsRepository.fromJsonString(loadFixtureBytes())),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(tester.widget(find.byKey(_showAllKey)), isA<TextButton>());
    expect(
      find.descendant(
        of: find.byKey(_showAllKey),
        matching: find.text('查看全部'),
      ),
      findsOneWidget,
    );
    expect(find.byTooltip('清除筛选'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('清除筛选'),
        matching: find.byKey(_showAllKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('清除筛选'), findsOneWidget);
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
