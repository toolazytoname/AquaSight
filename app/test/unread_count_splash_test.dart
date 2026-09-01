import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _hitKey = Key('unread-count-hit');
const _countKey = Key('unread-count');

void main() {
  testWidgets(
      'unread-count-hit is InkWell with theme primary splash; no wrapping onTap GestureDetector',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    final hitFinder = find.byKey(_hitKey);
    expect(hitFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(hitFinder);
    final scheme = Theme.of(tester.element(hitFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);

    final tooltip = tester.widget<Tooltip>(
      find.ancestor(
        of: find.byKey(_countKey),
        matching: find.byType(Tooltip),
      ),
    );
    expect(tooltip.message, '下一条未读');

    // Ancestors of unread-count only (not a global find.byType). InkWell
    // inserts an inner GestureDetector with onTap; skip those descendants.
    // Tooltip's detector must have onTap == null.
    final gestureDetectors = find.ancestor(
      of: find.byKey(_countKey),
      matching: find.byType(GestureDetector),
    );
    for (final element in gestureDetectors.evaluate()) {
      final insideInkWell = find
          .descendant(
            of: hitFinder,
            matching: find.byWidget(element.widget),
          )
          .evaluate()
          .isNotEmpty;
      if (insideInkWell) continue;
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
