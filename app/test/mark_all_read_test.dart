import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');
const _toggleKey = Key('unread-only-toggle');
const _searchKey = Key('timeline-search');
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
  testWidgets('fixture with all unread shows 全标已读; tap marks all 6',
      (tester) async {
    final store = ReadStore.memory();
    await _pumpFixture(tester, readStore: store);

    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.text('全标已读'), findsNothing);
    expect(_countText(tester), '未读 6');
    expect(find.text('已读'), findsNothing);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_markAllKey), findsOneWidget);
    expect(find.text('全标已读'), findsOneWidget);

    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.text('全标已读'), findsNothing);
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length));
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isTrue);
      expect(find.byKey(Key('event-card-$id-read')), findsOneWidget);
    }
  });

  testWidgets('one pre-seeded read then tap marks the rest; 未读 0',
      (tester) async {
    final store = ReadStore.memory({'same-day-breaking'});
    await _pumpFixture(tester, readStore: store);

    expect(_countText(tester), '未读 5');
    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-breaking-read')),
        findsOneWidget);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length));
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isTrue);
    }
  });

  testWidgets(
      'unread-only + source + search still marks the full set', (tester) async {
    final store = ReadStore.memory();
    await _pumpFixture(tester, readStore: store);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isTrue);

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), 'english');
    await tester.pumpAndSettle();

    expect(_countText(tester), '未读 6');
    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(find.byKey(_markAllKey), findsNothing);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isTrue);
    }
    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
  });

  testWidgets('loading state has no overflow and no mark-all-read',
      (tester) async {
    final repo = EventsRepository(
      loadLive: () => Future<String>.delayed(
        const Duration(milliseconds: 50),
        loadFixtureBytes,
      ),
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
      ),
    );
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);

    await tester.pumpAndSettle();
    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('error state has no overflow and does not fetch HTTP',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadFallback: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.byKey(_countKey), findsNothing);
  });

  testWidgets('empty items has no overflow and no mark-all-read',
      (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);
  });

  testWidgets('already 0 unread hides overflow and mark-all-read',
      (tester) async {
    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({..._allFixtureIds}),
    );

    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.text('全标已读'), findsNothing);
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length));
  });

  testWidgets('390-wide phone AppBar does not overflow', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;

    await _pumpFixture(tester);

    expect(tester.takeException(), isNull);
    expect(find.byKey(_countKey), findsOneWidget);
    expect(find.byKey(_toggleKey), findsOneWidget);
    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(tester.getSize(find.byType(AppBar)).height,
        lessThanOrEqualTo(kToolbarHeight + 1));

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    expect(find.text('全标已读'), findsOneWidget);

    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length));
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  ReadStore? readStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
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
