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
const _dup10Key = Key('event-card-same-day-breaking-dup-10');
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

void main() {
  testWidgets(
      'tall list: unread-count walks dup-10 then dup-11 then top',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final readIds = {
      ..._allFixtureIds,
      for (var i = 0; i < 12; i++)
        if (i != 10 && i != 11) 'same-day-breaking-dup-$i',
    };
    final readStore = ReadStore.memory(readIds);

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

    expect(find.byKey(_dup10Key), findsOneWidget);
    final listTop = tester.getTopLeft(find.byKey(_scrollKey)).dy;
    final firstCardTop = tester.getTopLeft(find.byKey(_dup10Key)).dy;
    expect(firstCardTop, greaterThanOrEqualTo(listTop));
    expect(firstCardTop, lessThanOrEqualTo(listTop + _kDayHeaderExtent + 8));
    final firstOffset = _scrollPixels(tester);
    expect(firstOffset, greaterThan(1));

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_dup11Key), findsOneWidget);
    final secondCardTop = tester.getTopLeft(find.byKey(_dup11Key)).dy;
    expect(secondCardTop, greaterThanOrEqualTo(listTop));
    expect(secondCardTop, lessThanOrEqualTo(listTop + _kDayHeaderExtent + 8));
    final secondOffset = _scrollPixels(tester);
    expect((secondOffset - firstOffset).abs(), greaterThan(1));

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(readStore.isRead('same-day-breaking-dup-10'), isFalse);
    expect(readStore.isRead('same-day-breaking-dup-11'), isFalse);
    expect(_countText(tester), countBefore);
    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_toggle(tester).value, isFalse);
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
