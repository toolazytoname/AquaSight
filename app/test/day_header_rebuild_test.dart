import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/timeline_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _todayNow = DateTime.parse('2026-08-26T02:00:00.000Z');

/// Beijing 2026-08-27 00:00 (next calendar day).
final _nextBeijingDay = DateTime.parse('2026-08-26T16:00:00.000Z');

const _scrollKey = Key('timeline-scroll');
const _todayGroupKey = Key('day-group-2026-08-26');
const _todayUnreadKey = Key('day-group-2026-08-26-unread');
const _searchIconKey = Key('timeline-search-icon');
const _breakingKey = Key('event-card-same-day-breaking');

/// Same fixed extent as `_kDayHeaderExtent` in timeline_page.dart.
const _kDayHeaderExtent = 40.0;

void main() {
  testWidgets(
      'search-icon focus setState keeps the day-group Element and 今天',
      (tester) async {
    await _pumpFixture(tester, now: () => _todayNow);

    final header = tester.element(find.byKey(_todayGroupKey));
    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(_searchIconKey));
    await tester.pumpAndSettle();

    expect(tester.element(find.byKey(_todayGroupKey)), same(header));
    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );
  });

  testWidgets('opening a breaking card still decrements that group unread by 1',
      (tester) async {
    final opened = <Uri>[];
    await _pumpFixture(
      tester,
      now: () => _todayNow,
      openUrl: (uri) async => opened.add(uri),
    );

    final before = _unreadNumber(tester, _todayUnreadKey);

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, isNotEmpty);
    expect(_unreadNumber(tester, _todayUnreadKey), before - 1);
  });

  testWidgets(
      'mutable now across Beijing midnight rebuilds 今天 into 昨天',
      (tester) async {
    var now = _todayNow;
    await _pumpFixture(
      tester,
      now: () => now,
      tickRelativeTime: true,
    );

    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsOneWidget,
    );

    now = _nextBeijingDay;
    await tester.pump(relativeTimeTick);

    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('昨天')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('今天')),
      findsNothing,
    );
  });

  testWidgets('tap 昨天 still jumps to that group start', (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpTall(tester, now: () => _nextBeijingDay);

    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('昨天')),
      findsOneWidget,
    );
    expect(_scrollMax(tester), greaterThan(400));

    await tester.drag(find.byKey(_scrollKey), const Offset(0, -250));
    await tester.pumpAndSettle();
    expect(_scrollPixels(tester), greaterThan(200));

    await tester.tap(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(1));
    expect(
      find.descendant(of: find.byKey(_todayGroupKey), matching: find.text('昨天')),
      findsOneWidget,
    );
    final listTop = tester.getTopLeft(find.byKey(_scrollKey)).dy;
    expect(
      tester.getTopLeft(find.byKey(_todayGroupKey)).dy - listTop,
      lessThanOrEqualTo(_kDayHeaderExtent),
    );
  });
}

int _unreadNumber(WidgetTester tester, Key key) {
  return int.parse(tester.widget<Text>(find.byKey(key)).data!);
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required DateTime Function() now,
  Future<void> Function(Uri uri)? openUrl,
  bool tickRelativeTime = false,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl ?? _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: now,
      tickRelativeTime: tickRelativeTime,
    ),
  );
  if (tickRelativeTime) {
    await tester.pump();
  } else {
    await tester.pumpAndSettle();
  }
}

Future<void> _pumpTall(
  WidgetTester tester, {
  required DateTime Function() now,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(_tallFixtureJson()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: now,
    ),
  );
  await tester.pumpAndSettle();
}

/// Extra same-day breaking cards so the list can scroll past one header
/// (`maxScrollExtent > 400`).
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
