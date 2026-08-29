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

/// ≥8 names, each length ≥10, so a 320-wide viewport overflows.
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
  testWidgets('全部 is pinned left; source chips scroll; tap selected returns all',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;

    await _pumpOverflowFeed(tester);

    expect(find.byKey(_allKey), findsOneWidget);
    expect(find.byKey(_scrollKey), findsOneWidget);
    expect(
      find.descendant(of: find.byKey(_scrollKey), matching: find.byKey(_allKey)),
      findsNothing,
    );
    for (final name in _longSources) {
      expect(
        find.descendant(
          of: find.byKey(_scrollKey),
          matching: find.byKey(Key('source-filter-$name')),
        ),
        findsOneWidget,
      );
    }

    final allDxBefore = tester.getTopLeft(find.byKey(_allKey)).dx;
    final sourceDxBefore = {
      for (final name in _longSources)
        name: tester.getTopLeft(find.byKey(Key('source-filter-$name'))).dx,
    };

    await tester.drag(find.byKey(_scrollKey), const Offset(-80, 0));
    await tester.pumpAndSettle();

    final allDxAfter = tester.getTopLeft(find.byKey(_allKey)).dx;
    expect((allDxAfter - allDxBefore).abs(), lessThanOrEqualTo(1));

    final moved = _longSources.where((name) {
      final after = tester.getTopLeft(find.byKey(Key('source-filter-$name'))).dx;
      return (after - sourceDxBefore[name]!).abs() >= 20;
    });
    expect(moved, isNotEmpty);

    final first = _longSources.first;
    final firstKey = Key('source-filter-$first');
    await _tapChip(tester, firstKey);

    expect(_chip(tester, firstKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(Key('event-card-${_eventIds.first}')), findsOneWidget);
    for (final id in _eventIds.skip(1)) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }

    await _tapChip(tester, firstKey);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, firstKey).selected, isFalse);
    _expectAllOverflowCards();

    await _tapChip(tester, _allKey);

    expect(_chip(tester, _allKey).selected, isTrue);
    _expectAllOverflowCards();
  });
}

Future<void> _pumpOverflowFeed(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(_overflowJson()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
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

Future<void> _tapChip(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

void _expectAllOverflowCards() {
  for (final id in _eventIds) {
    expect(find.byKey(Key('event-card-$id')), findsOneWidget);
  }
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
