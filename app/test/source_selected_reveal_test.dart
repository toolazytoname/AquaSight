import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _allKey = Key('source-filter-all');
const _scrollKey = Key('source-filter-scroll');
const _hotelKey = Key('source-filter-hotelwirexx');

/// T86 overflow fixture: ≥8 names, each length ≥10, so a 320-wide viewport overflows.
const _longSources = [
  'alphastation',
  'bravonetwork',
  'charliefeed',
  'deltaportal',
  'echomagazine',
  'foxtrotnews',
  'golfjournal',
  'hotelwirexx',
];

const _eventIds = [
  'pin-alpha',
  'pin-bravo',
  'pin-charlie',
  'pin-delta',
  'pin-echo',
  'pin-foxtrot',
  'pin-golf',
  'pin-hotel',
];

void main() {
  testWidgets(
      'memory(hotelwirexx) scrolls the persisted chip into the filter strip',
      (tester) async {
    _setNarrowViewport(tester);

    await _pumpOverflowFeed(
      tester,
      sourceFilter: SourceFilterStore.memory('hotelwirexx'),
    );

    expect(_chip(tester, _hotelKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(
      find.descendant(of: find.byKey(_scrollKey), matching: find.byKey(_allKey)),
      findsNothing,
    );

    final hotelRect = tester.getRect(find.byKey(_hotelKey));
    final scrollRect = tester.getRect(find.byKey(_scrollKey));
    expect(hotelRect.overlaps(scrollRect), isTrue);

    await _tapChip(tester, _hotelKey);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _hotelKey).selected, isFalse);
  });

  testWidgets('memory(null) does not scroll the source chip strip',
      (tester) async {
    _setNarrowViewport(tester);

    await _pumpOverflowFeed(
      tester,
      sourceFilter: SourceFilterStore.memory(),
    );

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _hotelKey).selected, isFalse);
    expect(_scrollPixels(tester), 0);

    final firstKey = Key('source-filter-${_longSources.first}');
    final firstRect = tester.getRect(find.byKey(firstKey));
    final scrollRect = tester.getRect(find.byKey(_scrollKey));
    expect(firstRect.overlaps(scrollRect), isTrue);
  });
}

void _setNarrowViewport(WidgetTester tester) {
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  tester.view.physicalSize = const Size(320, 800);
  tester.view.devicePixelRatio = 1;
}

Future<void> _pumpOverflowFeed(
  WidgetTester tester, {
  required SourceFilterStore sourceFilter,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(_overflowJson()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilter,
    ),
  );
  await tester.pumpAndSettle();
}

String _overflowJson() {
  return jsonEncode({
    'updatedAt': '2026-08-26T12:00:00.000Z',
    'sourceErrors': [],
    'items': [
      for (var i = 0; i < _longSources.length; i++)
        {
          'id': _eventIds[i],
          'title': 'Overflow ${_longSources[i]}',
          'url': 'https://example.com/${_eventIds[i]}',
          'source': _longSources[i],
          'level': 'normal',
          'reason': 'pin-all overflow fixture',
          'score': 1,
          'publishedAt': '2026-08-26T12:00:00.000Z',
        },
    ],
  });
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .state<ScrollableState>(
        find.descendant(
          of: find.byKey(_scrollKey),
          matching: find.byType(Scrollable),
        ),
      )
      .position
      .pixels;
}

Future<void> _tapChip(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
