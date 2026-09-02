import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingScoreKey = Key('event-card-same-day-breaking-score');

void main() {
  testWidgets(
      'event-card-same-day-breaking-score nearest InkWell customBorder is radius 8; splash tokens stay; no onTap',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(tester);

    final scoreFinder = find.byKey(_breakingScoreKey);
    expect(scoreFinder, findsOneWidget);
    expect(tester.widget(scoreFinder), isA<Text>());

    final inkWellFinder = find
        .ancestor(
          of: scoreFinder,
          matching: find.byType(InkWell),
        )
        .first;
    final inkWell = tester.widget<InkWell>(inkWellFinder);
    final scheme = Theme.of(tester.element(inkWellFinder)).colorScheme;

    expect(inkWell.customBorder, isA<RoundedRectangleBorder>());
    expect(
      (inkWell.customBorder! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNull);
    expect(inkWell.onLongPress, isNotNull);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpDefault(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: _forbidCopy,
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
