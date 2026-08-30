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

const _scrollKey = Key('timeline-scroll');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _feedLatestSnackKey = Key('feed-latest-snackbar');
const _errorSnackKey = Key('feed-error-snackbar');
const _retryKey = Key('feed-error-retry');
const _hitKey = Key('last-refresh-hit');
const _t1 = '2026-08-26T01:00:00.000Z';
const _t2 = '2026-08-26T02:00:00.000Z';
const _refreshFail = '刷新失败：源不可用';

void main() {
  testWidgets(
      'feed-updated and feed-latest SnackBars can be dismissed via close',
      (tester) async {
    var loads = 0;
    var stamp = _t1;
    var ids = ['a'];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return _eventsJson(stamp, ids);
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    stamp = _t2;
    ids = ['a', 'b'];
    await tester.tap(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新 · 1 条新'), findsOneWidget);
    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(const Key('event-card-b')), findsOneWidget);
    _expectCloseInside(find.byKey(_feedUpdatedSnackKey));

    await tester.tap(_closeInside(find.byKey(_feedUpdatedSnackKey)));
    await tester.pumpAndSettle();

    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新 · 1 条新'), findsNothing);
    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(_scrollKey), findsOneWidget);

    await _pullReload(tester);
    expect(loads, 3);
    expect(find.byKey(_feedLatestSnackKey), findsOneWidget);
    expect(find.text('已是最新'), findsOneWidget);
    _expectCloseInside(find.byKey(_feedLatestSnackKey));

    await tester.tap(_closeInside(find.byKey(_feedLatestSnackKey)));
    await tester.pumpAndSettle();

    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(_scrollKey), findsOneWidget);
  });

  testWidgets(
      'list refresh fail keeps 重试 and also has a close icon',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return _eventsJson(_t1, ['a']);
            throw EventsLoadException(_refreshFail);
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(_errorSnackKey), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    expect(find.byKey(_errorSnackKey), findsOneWidget);
    expect(find.byKey(_retryKey), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);
    expect(find.text(_refreshFail), findsOneWidget);
    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(_scrollKey), findsOneWidget);

    final closeInError = find.descendant(
      of: find.byKey(_errorSnackKey),
      matching: find.byIcon(Icons.close),
    );
    expect(closeInError, findsOneWidget);
  });
}

Finder _closeInside(Finder snack) {
  final byIcon = find.descendant(
    of: snack,
    matching: find.byIcon(Icons.close),
  );
  if (byIcon.evaluate().isNotEmpty) return byIcon;
  final zh = find.descendant(
    of: snack,
    matching: find.byTooltip('关闭'),
  );
  if (zh.evaluate().isNotEmpty) return zh;
  return find.descendant(
    of: snack,
    matching: find.byTooltip('Close'),
  );
}

void _expectCloseInside(Finder snack) {
  expect(_closeInside(snack), findsOneWidget);
}

String _eventsJson(String updatedAt, List<String> ids) {
  return jsonEncode({
    'updatedAt': updatedAt,
    'sourceErrors': [],
    'items': [
      for (final id in ids)
        {
          'id': id,
          'title': 'Card $id',
          'url': 'https://example.com/$id',
          'source': 'hn',
          'level': 'normal',
          'reason': 'feed-snack-close',
          'score': 1,
          'publishedAt': updatedAt,
        },
    ],
  });
}

Future<void> _pullReload(WidgetTester tester) async {
  final refresh = tester
      .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
      .show();
  await tester.pumpAndSettle();
  await refresh;
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
