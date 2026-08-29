import 'dart:async';
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

const _emptyKey = Key('timeline-empty');
const _errorSnackKey = Key('feed-error-snackbar');
const _retryKey = Key('feed-error-retry');
const _errorPageKey = Key('timeline-error');
const _errorPageRetryKey = Key('timeline-error-retry');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _feedLatestSnackKey = Key('feed-latest-snackbar');
const _breakingKey = Key('event-card-same-day-breaking');
const _updatedA = '2026-08-26T01:00:00.000Z';
const _updatedB = '2026-08-26T03:00:00.000Z';
const _refreshFail = '刷新失败：源不可用';

void main() {
  testWidgets(
      'pull-to-refresh fail on empty list: snackbar with 重试; empty stays',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return _emptyFixture(_updatedA);
            throw EventsLoadException(_refreshFail);
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
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_errorSnackKey), findsNothing);
    expect(find.byKey(_retryKey), findsNothing);
    expect(find.byKey(_errorPageKey), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    _expectEmptyErrorSnackbar();
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_errorPageKey), findsNothing);
    expect(find.byKey(_errorPageRetryKey), findsNothing);
    expect(find.text('加载失败'), findsNothing);
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
  });

  testWidgets(
      'empty feed-error-retry success loads cards and shows 已更新',
      (tester) async {
    var loads = 0;
    Completer<String>? hang;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return _emptyFixture(_updatedA);
            if (loads == 2) throw EventsLoadException(_refreshFail);
            return hang!.future;
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await _pullReload(tester);
    expect(loads, 2);
    _expectEmptyErrorSnackbar();
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);

    hang = Completer<String>();
    await tester.tap(find.byKey(_retryKey));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(loads, 3);
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_errorPageKey), findsNothing);

    hang.complete(_fixtureWithUpdatedAt(_updatedB));
    await tester.pumpAndSettle();

    expect(loads, 3);
    expect(find.byKey(_errorSnackKey), findsNothing);
    expect(find.byKey(_retryKey), findsNothing);
    expect(find.text(_refreshFail), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新'), findsOneWidget);
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(find.byKey(_errorPageKey), findsNothing);
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

void _expectEmptyErrorSnackbar() {
  expect(find.byKey(_errorSnackKey), findsOneWidget);
  expect(find.byKey(_retryKey), findsOneWidget);
  expect(find.text('重试'), findsOneWidget);
  expect(find.text(_refreshFail), findsOneWidget);
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
