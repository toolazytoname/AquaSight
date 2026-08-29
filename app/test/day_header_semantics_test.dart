import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _now = DateTime.parse('2026-08-26T02:00:00.000Z');

const _scrollKey = Key('timeline-scroll');
const _todayGroupKey = Key('day-group-2026-08-26');
const _earlierGroupKey = Key('day-group-2026-08-24');
final _unknownGroupKey = Key('day-group-$unknownDateLabel');

/// Same fixed extent as `_kDayHeaderExtent` in timeline_page.dart.
const _kDayHeaderExtent = 48.0;

void main() {
  testWidgets(
      'fixture day bars are headings; calendar stays tooltip-only',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    _expectHeaderWidgetUnder(_todayGroupKey);
    expect(
      find.semantics.byPredicate(
        (n) =>
            n.hasFlag(SemanticsFlag.isHeader) &&
            (n.label == '今天' || n.label.startsWith('今天')),
      ),
      findsAtLeast(1),
    );

    expect(find.bySemanticsLabel('2026-08-26'), findsNothing);
    expect(_tooltipSemantics('2026-08-26'), findsOne);

    await _dragUntilHeaderPins(tester, headerKey: _earlierGroupKey);
    _expectHeaderWidgetUnder(_earlierGroupKey);
    expect(
      find.semantics.byPredicate(
        (n) =>
            n.hasFlag(SemanticsFlag.isHeader) &&
            (n.label == '2026-08-24' || n.label.startsWith('2026-08-24')),
      ),
      findsAtLeast(1),
    );

    await tester.ensureVisible(find.byKey(_unknownGroupKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_unknownGroupKey));
    await tester.pumpAndSettle();
    _expectHeaderWidgetUnder(_unknownGroupKey);
    expect(
      find.semantics.byPredicate(
        (n) =>
            n.hasFlag(SemanticsFlag.isHeader) &&
            (n.label == unknownDateLabel ||
                n.label.startsWith(unknownDateLabel)),
      ),
      findsAtLeast(1),
    );
  });

  testWidgets('tap day-group-2026-08-26 still jumps to that group start',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpTall(tester);

    expect(_scrollMax(tester), greaterThan(400));
    expect(find.byKey(_todayGroupKey), findsOneWidget);

    await tester.drag(find.byKey(_scrollKey), const Offset(0, -250));
    await tester.pumpAndSettle();
    expect(_scrollPixels(tester), greaterThan(200));

    await tester.tap(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(1));
  });
}

void _expectHeaderWidgetUnder(Key key) {
  expect(find.byKey(key), findsOneWidget);
  expect(
    find.descendant(
      of: find.byKey(key),
      matching: find.byWidgetPredicate(
        (widget) => widget is Semantics && widget.properties.header == true,
      ),
    ),
    findsOneWidget,
  );
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _now,
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpTall(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(_tallFixtureJson()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _now,
    ),
  );
  await tester.pumpAndSettle();
}

/// Extra same-day breaking cards so the list can scroll past one header
/// (`maxScrollExtent > 400`), matching [day_header_jump_test].
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
