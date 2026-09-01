import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _todayGroupKey = Key('day-group-2026-08-26');
const _todayUnreadKey = Key('day-group-2026-08-26-unread');

void main() {
  testWidgets(
      'day header InkWell splash and highlight use theme primary at low alpha',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    final materialFinder = find.byKey(_todayGroupKey);
    expect(materialFinder, findsOneWidget);

    final inkWellFinder = find.descendant(
      of: materialFinder,
      matching: find.byType(InkWell),
    );
    expect(inkWellFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(inkWellFinder);
    final scheme = Theme.of(tester.element(inkWellFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);
    expect(inkWell.onLongPress, isNotNull);

    // Under this Material only (not a global find.byType). InkWell inserts an
    // inner GestureDetector with onTap; the unread-number Tooltip may add
    // another. Those two are skipped. Any other detector must have onTap == null.
    final gestureDetectors = find.descendant(
      of: materialFinder,
      matching: find.byType(GestureDetector),
    );
    for (final element in gestureDetectors.evaluate()) {
      final insideInkWell = find
          .descendant(
            of: inkWellFinder,
            matching: find.byWidget(element.widget),
          )
          .evaluate()
          .isNotEmpty;
      if (insideInkWell) continue;

      final unreadTooltipDetector = find
          .ancestor(
            of: find.byKey(_todayUnreadKey),
            matching: find.byWidget(element.widget),
          )
          .evaluate()
          .isNotEmpty;
      if (unreadTooltipDetector) continue;

      expect((element.widget as GestureDetector).onTap, isNull);
    }
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
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
      now: () => _fixedNow,
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
