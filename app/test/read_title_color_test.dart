import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _unreadTitleKey = Key('event-card-same-day-normal-high-score-title');

void main() {
  testWidgets(
      'read breaking title uses onSurfaceVariant; unread title stays onSurface',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({'same-day-breaking'}),
    );

    final breakingFinder = find.byKey(_breakingTitleKey);
    final unreadFinder = find.byKey(_unreadTitleKey);
    expect(breakingFinder, findsOneWidget);
    expect(unreadFinder, findsOneWidget);

    final breaking = tester.widget<Text>(breakingFinder);
    final unread = tester.widget<Text>(unreadFinder);
    final scheme = Theme.of(tester.element(breakingFinder)).colorScheme;

    expect(breaking.style!.color, scheme.onSurfaceVariant);
    expect(breaking.style!.fontWeight, FontWeight.w600);
    expect(unread.style!.color, scheme.onSurface);
    expect(unread.style!.fontWeight, FontWeight.w600);
    expect(unread.style!.color, isNot(scheme.onSurfaceVariant));
  });

  testWidgets(
      'empty ReadStore: breaking title uses onSurface',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester, readStore: ReadStore.memory());

    final breakingFinder = find.byKey(_breakingTitleKey);
    expect(breakingFinder, findsOneWidget);

    final breaking = tester.widget<Text>(breakingFinder);
    final scheme = Theme.of(tester.element(breakingFinder)).colorScheme;
    expect(breaking.style!.color, scheme.onSurface);
    expect(breaking.style!.fontWeight, FontWeight.w600);
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required ReadStore readStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore,
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
