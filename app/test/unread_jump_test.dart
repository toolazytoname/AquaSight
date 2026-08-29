import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _now = DateTime.parse('2026-08-26T02:00:00.000Z');

const _countKey = Key('unread-count');
const _scrollKey = Key('timeline-scroll');
const _toggleKey = Key('unread-only-toggle');
const _dup11Key = Key('event-card-same-day-breaking-dup-11');

/// Same fixed extent as `_kDayHeaderExtent` in timeline_page.dart.
const _kDayHeaderExtent = 48.0;

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

const _todayIdsIncludingDups = {
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'same-day-breaking-dup-0',
  'same-day-breaking-dup-1',
  'same-day-breaking-dup-2',
  'same-day-breaking-dup-3',
  'same-day-breaking-dup-4',
  'same-day-breaking-dup-5',
  'same-day-breaking-dup-6',
  'same-day-breaking-dup-7',
  'same-day-breaking-dup-8',
  'same-day-breaking-dup-9',
  'same-day-breaking-dup-10',
  'same-day-breaking-dup-11',
};

void main() {
  testWidgets(
      'default fixture all unread + memory(120): tap jumps to top; 第一条未读; no Semantics label',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(120),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byTooltip('第一条未读'), findsOneWidget);
    expect(find.bySemanticsLabel('第一条未读'), findsNothing);

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(find.byTooltip('下一条未读'), findsOneWidget);
    expect(find.bySemanticsLabel('下一条未读'), findsNothing);
  });

  testWidgets(
      'tall list: tap unread-count jumps to first visible unread under day bar',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final onlyDup11Unread = {
      ..._allFixtureIds,
      for (final id in _todayIdsIncludingDups)
        if (id != 'same-day-breaking-dup-11') id,
    };
    final readStore = ReadStore.memory(onlyDup11Unread);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(_tallFixtureJson()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          shared.add((title: title, url: url));
        },
        readStore: readStore,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => _now,
      ),
    );
    await tester.pumpAndSettle();

    expect(_scrollMax(tester), greaterThan(400));
    expect(find.byTooltip('第一条未读'), findsOneWidget);
    final countBefore = _countText(tester);
    expect(_toggle(tester).value, isFalse);

    await _dragNearBottom(tester);
    expect(_scrollPixels(tester), greaterThan(1));

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_dup11Key), findsOneWidget);
    final listTop = tester.getTopLeft(find.byKey(_scrollKey)).dy;
    final cardTop = tester.getTopLeft(find.byKey(_dup11Key)).dy;
    expect(cardTop, greaterThanOrEqualTo(listTop));
    expect(cardTop, lessThanOrEqualTo(listTop + _kDayHeaderExtent + 8));
    expect(_scrollPixels(tester), greaterThan(1));
    expect(_countText(tester), countBefore);
    expect(readStore.isRead('same-day-breaking-dup-11'), isFalse);
    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();
    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(readStore.isRead('same-day-breaking-dup-11'), isFalse);
  });

  testWidgets('all read + memory(120): tooltip 回到顶部; tap jumps to top',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory({..._allFixtureIds}),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(120),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byTooltip('回到顶部'), findsOneWidget);
    expect(_countText(tester), '回顶');

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(find.byTooltip('回到顶部'), findsOneWidget);
  });
}

/// Extra same-day breaking cards so the list can scroll past one header
/// and into the 2026-08-24 group (`maxScrollExtent > 400`).
String _tallFixtureJson() {
  final raw = loadFixtureJson();
  final items = List<Map<String, dynamic>>.from(
    (raw['items'] as List).map(
      (row) => Map<String, dynamic>.from(row as Map),
    ),
  );
  final template = Map<String, dynamic>.from(
    items.firstWhere((row) => row['id'] == 'same-day-breaking'),
  );
  for (var i = 0; i < 12; i++) {
    items.add({
      ...template,
      'id': 'same-day-breaking-dup-$i',
    });
  }
  raw['items'] = items;
  return jsonEncode(raw);
}

Future<void> _dragNearBottom(WidgetTester tester) async {
  for (var i = 0; i < 40; i++) {
    final offset = _scrollPixels(tester);
    final max = _scrollMax(tester);
    if (offset >= max - 20) return;
    await tester.drag(find.byKey(_scrollKey), const Offset(0, -250));
    await tester.pumpAndSettle();
  }
  fail('timeline-scroll did not reach near the bottom');
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
}

double _scrollMax(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .position
      .maxScrollExtent;
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
