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
const _earlierGroupKey = Key('day-group-2026-08-24');
const _seenOnlyKey = Key('event-card-seen-only');

/// Same fixed extent as `_kDayHeaderExtent` in timeline_page.dart.
const _kDayHeaderExtent = 48.0;

void main() {
  testWidgets(
      'tap day header jumps to that group start; already there is a no-op',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final opened = <Uri>[];
    final readStore = ReadStore.memory();
    await _pumpTall(
      tester,
      openUrl: (uri) async => opened.add(uri),
      readStore: readStore,
    );

    expect(_scrollMax(tester), greaterThan(400));
    expect(find.byKey(_todayGroupKey), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );

    await tester.drag(find.byKey(_scrollKey), const Offset(0, -250));
    await tester.pumpAndSettle();
    expect(_scrollPixels(tester), greaterThan(200));

    await tester.tap(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(1));
    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );
    final listTop = tester.getTopLeft(find.byKey(_scrollKey)).dy;
    expect(
      tester.getTopLeft(find.byKey(_todayGroupKey)).dy - listTop,
      lessThanOrEqualTo(_kDayHeaderExtent),
    );

    await _dragUntilHeaderPins(tester, headerKey: _earlierGroupKey);
    await tester.drag(find.byKey(_scrollKey), const Offset(0, -80));
    await tester.pumpAndSettle();
    final midEarlier = _scrollPixels(tester);
    expect(midEarlier, greaterThan(1));

    await tester.tap(find.byKey(_earlierGroupKey));
    await tester.pumpAndSettle();

    final earlierStart = _scrollPixels(tester);
    expect(earlierStart, greaterThan(1));
    expect((earlierStart - midEarlier).abs(), greaterThan(1));
    expect(find.byKey(_seenOnlyKey), findsOneWidget);
    expect(tester.getTopLeft(find.byKey(_seenOnlyKey)).dy, greaterThan(listTop));
    expect(
      tester.getTopLeft(find.byKey(_earlierGroupKey)).dy - listTop,
      lessThanOrEqualTo(_kDayHeaderExtent),
    );

    // First tap parked on seen-only (group start). The 2026-08-24 group also
    // has missing-title-zh unread, so a second tap advances (T159) instead of
    // staying at the group start.
    await tester.tap(find.byKey(_earlierGroupKey));
    await tester.pumpAndSettle();
    expect((_scrollPixels(tester) - earlierStart).abs(), greaterThan(1));
    expect(_scrollPixels(tester), greaterThan(1));

    expect(opened, isEmpty);
    expect(readStore.ids, isEmpty);
  });
}

Future<void> _pumpTall(
  WidgetTester tester, {
  Future<void> Function(Uri uri)? openUrl,
  ReadStore? readStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(_tallFixtureJson()),
      openUrl: openUrl ?? _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _now,
    ),
  );
  await tester.pumpAndSettle();
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

double _scrollMax(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .position
      .maxScrollExtent;
}

/// Drag the list up until [headerKey] is pinned at the visible top.
Future<void> _dragUntilHeaderPins(
  WidgetTester tester, {
  required Key headerKey,
}) async {
  final listTop = tester.getTopLeft(find.byKey(_scrollKey)).dy;
  for (var i = 0; i < 40; i++) {
    if (find.byKey(headerKey).evaluate().isNotEmpty) {
      final headerTop = tester.getTopLeft(find.byKey(headerKey)).dy;
      final delta = headerTop - listTop;
      if (delta >= -1 && delta <= _kDayHeaderExtent) {
        return;
      }
      final drag = delta.clamp(40.0, 200.0);
      await tester.drag(find.byKey(_scrollKey), Offset(0, -drag));
      await tester.pumpAndSettle();
      continue;
    }
    await tester.drag(find.byKey(_scrollKey), const Offset(0, -200));
    await tester.pumpAndSettle();
  }
  fail('$headerKey did not pin at the top of timeline-scroll');
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
