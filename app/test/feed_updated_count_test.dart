import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _scrollKey = Key('timeline-scroll');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _feedLatestSnackKey = Key('feed-latest-snackbar');
const _hitKey = Key('last-refresh-hit');
const _t1 = '2026-08-26T01:00:00.000Z';
const _t2 = '2026-08-26T02:00:00.000Z';
const _t3 = '2026-08-26T03:00:00.000Z';

void main() {
  testWidgets(
      'new id after stamp change shows 已更新 · n 条新; same ids stay 已更新',
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
    expect(find.text('已更新'), findsNothing);

    stamp = _t2;
    ids = ['a', 'b'];
    await tester.tap(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新 · 1 条新'), findsOneWidget);
    expect(find.text('已更新'), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));

    await _pullReload(tester);
    expect(loads, 3);
    expect(find.byKey(_feedLatestSnackKey), findsOneWidget);
    expect(find.text('已是最新'), findsOneWidget);
    expect(find.textContaining('条新'), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新'), findsNothing);

    stamp = _t3;
    await _pullReload(tester);
    expect(loads, 4);
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新'), findsOneWidget);
    expect(find.text('已更新 · 1 条新'), findsNothing);
    expect(find.textContaining('条新'), findsNothing);
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
  });
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
          'reason': 'feed-updated-count',
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

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
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
