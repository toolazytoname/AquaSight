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

const _countKey = Key('unread-count');
const _overflowKey = Key('appbar-overflow');
const _scrollKey = Key('timeline-scroll');

void main() {
  group('unreadCountLabel', () {
    test('0 is 回顶', () {
      expect(unreadCountLabel(0), '回顶');
    });

    test('1 is 未读 1', () {
      expect(unreadCountLabel(1), '未读 1');
    });

    test('6 is 未读 6', () {
      expect(unreadCountLabel(6), '未读 6');
    });

    test('99 is 未读 99', () {
      expect(unreadCountLabel(99), '未读 99');
    });

    test('100 is 未读 99+', () {
      expect(unreadCountLabel(100), '未读 99+');
    });

    test('1000 is 未读 99+', () {
      expect(unreadCountLabel(1000), '未读 99+');
    });

    test('negative is 回顶', () {
      expect(unreadCountLabel(-1), '回顶');
    });
  });

  testWidgets('fixture with 6 unread still shows 未读 6', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
    );

    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('100 unread shows 未读 99+ and keeps overflow', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(_jsonWithUnreadCount(100)),
    );

    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 99+');
    expect(find.byKey(_overflowKey), findsOneWidget);
  });

  testWidgets(
      '100 unread + memory(120): tap unread-count jumps to top',
      (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(_jsonWithUnreadCount(100)),
      scrollOffset: ScrollOffsetStore.memory(120),
    );

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(_countText(tester), '未读 99+');

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));
  });

  testWidgets('390-wide + 100 unread AppBar does not overflow', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;

    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(_jsonWithUnreadCount(100)),
    );

    expect(tester.takeException(), isNull);
    expect(_countText(tester), '未读 99+');
    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(tester.getSize(find.byType(AppBar)).height,
        lessThanOrEqualTo(kToolbarHeight + 1));
  });
}

Future<void> _pump(
  WidgetTester tester, {
  required EventsRepository repository,
  ScrollOffsetStore? scrollOffset,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: repository,
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: scrollOffset ?? ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

String _jsonWithUnreadCount(int n) {
  return jsonEncode({
    'updatedAt': '',
    'items': [
      for (var i = 0; i < n; i++)
        {
          'id': 'unread-$i',
          'title': 'Title $i',
          'url': 'https://example.com/$i',
          'source': 'hn',
          'level': 'normal',
          'reason': 'unread-cap',
          'score': 1,
          'publishedAt': '2026-08-25T16:30:00.000Z',
        },
    ],
  });
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
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
