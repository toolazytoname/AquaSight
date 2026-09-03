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
      'timeline and source-filter ScrollbarTheme crossAxisMargin is 2',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    final listFinder = find.byKey(const Key('timeline-scroll'));
    expect(listFinder, findsOneWidget);
    final listTheme = ScrollbarTheme.of(tester.element(listFinder));
    final listScheme = Theme.of(tester.element(listFinder)).colorScheme;
    expect(listTheme.crossAxisMargin, 2);
    expect(listTheme.minThumbLength, 48);
    expect(
      listTheme.thickness!.resolve(const <WidgetState>{}),
      8.0,
    );
    expect(listTheme.interactive, isTrue);
    expect(listTheme.radius, const Radius.circular(8));
    expect(
      listTheme.thumbColor?.resolve(const <WidgetState>{}),
      listScheme.outline,
    );

    final sourceFinder = find.byKey(const Key('source-filter-scrollbar'));
    expect(sourceFinder, findsOneWidget);
    final sourceTheme = ScrollbarTheme.of(tester.element(sourceFinder));
    final sourceScheme = Theme.of(tester.element(sourceFinder)).colorScheme;
    expect(sourceTheme.crossAxisMargin, 2);
    expect(sourceTheme.minThumbLength, 48);
    expect(
      sourceTheme.thickness!.resolve(const <WidgetState>{}),
      8.0,
    );
    expect(sourceTheme.interactive, isTrue);
    expect(sourceTheme.radius, const Radius.circular(8));
    expect(
      sourceTheme.thumbColor?.resolve(const <WidgetState>{}),
      sourceScheme.outline,
    );
  });
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
