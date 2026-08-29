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

void main() {
  testWidgets(
      'fixture day bars are headings; calendar stays tooltip-only',
      (tester) async {
    await _pumpFixture(tester);

    expect(find.byKey(_todayGroupKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_todayGroupKey),
        matching: find.byWidgetPredicate(
          (widget) => widget is Semantics && widget.properties.header == true,
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.semantics.byPredicate(
        (n) =>
            n.hasFlag(SemanticsFlag.isHeader) &&
            (n.label == '今天' || n.label.startsWith('今天')),
      ),
      findsAtLeast(1),
    );

    expect(find.byKey(_earlierGroupKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_earlierGroupKey),
        matching: find.byWidgetPredicate(
          (widget) => widget is Semantics && widget.properties.header == true,
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.semantics.byPredicate(
        (n) =>
            n.hasFlag(SemanticsFlag.isHeader) &&
            (n.label == '2026-08-24' || n.label.startsWith('2026-08-24')),
      ),
      findsAtLeast(1),
    );

    expect(find.byKey(_unknownGroupKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_unknownGroupKey),
        matching: find.byWidgetPredicate(
          (widget) => widget is Semantics && widget.properties.header == true,
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.semantics.byPredicate(
        (n) =>
            n.hasFlag(SemanticsFlag.isHeader) &&
            (n.label == unknownDateLabel ||
                n.label.startsWith(unknownDateLabel)),
      ),
      findsAtLeast(1),
    );

    expect(find.bySemanticsLabel('2026-08-26'), findsNothing);
    expect(_tooltipSemantics('2026-08-26'), findsOne);
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
