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

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _copySnackKey = Key('copy-snackbar');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _errorSnackKey = Key('feed-error-snackbar');
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';
const _laterStamp = '2026-08-26T02:00:00.000Z';
const _t1 = '2026-08-26T01:00:00.000Z';
const _refreshFail = '刷新失败：源不可用';
const _listAlignedMargin = EdgeInsets.fromLTRB(16, 8, 16, 16);

void main() {
  testWidgets(
      'long-press event-card-same-day-breaking-time copy-snackbar uses list-aligned floating margin',
      (tester) async {
    _setDefaultSurface(tester);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: (_) async {},
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    final snack = tester.widget<SnackBar>(find.byKey(_copySnackKey));
    expect(snack.margin, _listAlignedMargin);
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.duration, const Duration(seconds: 2));
  });

  testWidgets(
      'pull-to-refresh feed-updated-snackbar uses list-aligned floating margin',
      (tester) async {
    _setDefaultSurface(tester);
    var stamp = _tenMinutesAgo;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => _fixtureWithUpdatedAt(stamp),
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: (_) async {},
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => _fixedNow,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    stamp = _laterStamp;
    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();
    await refresh;

    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    final snack = tester.widget<SnackBar>(find.byKey(_feedUpdatedSnackKey));
    expect(snack.margin, _listAlignedMargin);
    expect(snack.behavior, SnackBarBehavior.floating);
  });

  testWidgets(
      'list refresh fail feed-error-snackbar margin stays unset and non-floating',
      (tester) async {
    _setDefaultSurface(tester);
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

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();
    await refresh;

    expect(loads, 2);
    expect(find.byKey(_errorSnackKey), findsOneWidget);
    expect(find.text(_refreshFail), findsOneWidget);
    final snack = tester.widget<SnackBar>(find.byKey(_errorSnackKey));
    expect(snack.margin, isNull);
    final behavior = snack.behavior;
    expect(
      behavior == null || behavior == SnackBarBehavior.fixed,
      isTrue,
    );
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  return jsonEncode(raw);
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
          'reason': 'floating-snack-margin',
          'score': 1,
          'publishedAt': updatedAt,
        },
    ],
  });
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
