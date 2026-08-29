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

const _scrollKey = Key('timeline-scroll');
const _todayGroupKey = Key('day-group-2026-08-26');
const _dup11Key = Key('event-card-same-day-breaking-dup-11');
const _toggleKey = Key('unread-only-toggle');

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
      'tap day header jumps to that group first unread; already parked is a no-op',
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

    expect(_scrollPixels(tester), lessThanOrEqualTo(1));
    expect(find.byKey(_todayGroupKey), findsOneWidget);

    await tester.tap(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_dup11Key), findsOneWidget);
    final listTop = tester.getTopLeft(find.byKey(_scrollKey)).dy;
    final cardTop = tester.getTopLeft(find.byKey(_dup11Key)).dy;
    expect(cardTop, greaterThanOrEqualTo(listTop));
    expect(cardTop, lessThanOrEqualTo(listTop + _kDayHeaderExtent + 8));
    expect(_scrollPixels(tester), greaterThan(1));

    final parked = _scrollPixels(tester);
    await tester.tap(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();
    expect((_scrollPixels(tester) - parked).abs(), lessThan(1));

    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_toggle(tester).value, isFalse);
    expect(readStore.isRead('same-day-breaking-dup-11'), isFalse);
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

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}
