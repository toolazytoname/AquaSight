import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _endKey = Key('timeline-end');

void main() {
  testWidgets(
      'timeline-end ancestor InkWell splash and highlight use theme primary at low alpha',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    final inkWellFinder = find.ancestor(
      of: find.byKey(_endKey),
      matching: find.byType(InkWell),
    );
    expect(inkWellFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(inkWellFinder);
    final scheme = Theme.of(tester.element(inkWellFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);

    final gestureDetectors = find.ancestor(
      of: find.byKey(_endKey),
      matching: find.byType(GestureDetector),
    );
    for (final element in gestureDetectors.evaluate()) {
      expect((element.widget as GestureDetector).onTap, isNull);
    }

    expect(_endTooltip(tester).message, '回到顶部');
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
