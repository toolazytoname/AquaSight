import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  testWidgets(
      'timeline and source-filter ScrollbarTheme track is visible while dragged',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    final listFinder = find.byKey(const Key('timeline-scroll'));
    expect(listFinder, findsOneWidget);
    _expectTrackTheme(ScrollbarTheme.of(tester.element(listFinder)));

    final sourceFinder = find.byKey(const Key('source-filter-scrollbar'));
    expect(sourceFinder, findsOneWidget);
    _expectTrackTheme(ScrollbarTheme.of(tester.element(sourceFinder)));
  });
}

void _expectTrackTheme(ScrollbarThemeData theme) {
  expect(
    theme.trackVisibility!.resolve(const {WidgetState.dragged}),
    isTrue,
  );
  expect(
    theme.trackVisibility!.resolve(const {WidgetState.hovered}),
    isTrue,
  );
  expect(
    theme.trackVisibility!.resolve(const {WidgetState.focused}),
    isTrue,
  );
  expect(
    theme.trackVisibility!.resolve(const <WidgetState>{}),
    isFalse,
  );
  expect(theme.interactive, isTrue);
  expect(theme.thickness!.resolve(const <WidgetState>{}), 8.0);
  expect(theme.radius, const Radius.circular(8));
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
