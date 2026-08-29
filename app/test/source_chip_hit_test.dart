import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
const _scrollKey = Key('source-filter-scroll');
const _breakingKey = Key('event-card-same-day-breaking');

/// ≥8 names, each length ≥10, so a 320-wide viewport overflows (T86).
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
      'source chips are 48 tall; padding tap selects weibo; 全部 stays pinned',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      tester.getSize(find.byKey(_allKey)).height,
      greaterThanOrEqualTo(48),
    );
    expect(
      tester.getSize(find.byKey(_weiboKey)).height,
      greaterThanOrEqualTo(48),
    );

    expect(
      find.descendant(of: find.byKey(_scrollKey), matching: find.byKey(_allKey)),
      findsNothing,
    );
    expect(
      find.descendant(
        of: find.byKey(_scrollKey),
        matching: find.byKey(_weiboKey),
      ),
      findsOneWidget,
    );

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tapAt(
      tester.getTopRight(find.byKey(_weiboKey)) + const Offset(-8, 4),
    );
    await tester.pumpAndSettle();

    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(
      find.byKey(const Key('event-card-same-day-normal-high-score')),
      findsNothing,
    );
    expect(find.byKey(const Key('event-card-seen-only')), findsNothing);
    expect(find.byKey(const Key('event-card-missing-title-zh')), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);
    expect(find.byKey(const Key('day-group-2026-08-26')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsNothing);
  });

  testWidgets('全部 stays pinned left when the source strip scrolls',
      (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;

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
  });
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
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

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
