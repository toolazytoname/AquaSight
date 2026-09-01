import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _endKey = Key('timeline-end');
const _scrollKey = Key('timeline-scroll');

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
      'default fixture: timeline-end ancestor Tooltip is 回到顶部; copy 没有更多了',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    expect(find.byKey(_endKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_endKey)).data, '没有更多了');
    expect(_endTooltip(tester).message, '回到顶部');
  });

  testWidgets(
      'all six cards read: timeline-end is 已全部看完; Tooltip still 回到顶部',
      (tester) async {
    _setPhoneSurface(tester);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory({..._allFixtureIds}),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_endKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_endKey)).data, '已全部看完');
    expect(_endTooltip(tester).message, '回到顶部');
  });

  testWidgets(
      'drag timeline-scroll then tap timeline-end jumps to pixels 0',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    await _dragNearBottom(tester);
    expect(_scrollPixels(tester), greaterThan(0));

    await tester.tap(find.byKey(_endKey));
    await tester.pumpAndSettle();
    expect(_scrollPixels(tester), 0);
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Tooltip _endTooltip(WidgetTester tester) {
  return tester.widget<Tooltip>(
    find.ancestor(
      of: find.byKey(_endKey),
      matching: find.byType(Tooltip),
    ),
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
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _dragNearBottom(WidgetTester tester) async {
  for (var i = 0; i < 40; i++) {
    final offset = _scrollPixels(tester);
    final max = tester
        .widget<CustomScrollView>(find.byKey(_scrollKey))
        .controller!
        .position
        .maxScrollExtent;
    if (offset >= max - 20 && offset > 0) return;
    await tester.drag(find.byKey(_scrollKey), const Offset(0, -250));
    await tester.pumpAndSettle();
  }
  fail('timeline-scroll did not reach near the bottom');
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .position
      .pixels;
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
