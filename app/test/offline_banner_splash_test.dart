import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _bannerKey = Key('offline-banner');

void main() {
  testWidgets(
      'offline-banner descendant InkWell uses theme primary splash; no wrapping onTap GestureDetector',
      (tester) async {
    _setPhoneSurface(tester);
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) throw EventsLoadException('HTTP 503');
            return loadFixtureBytes();
          },
          loadCache: () async => loads == 1 ? loadFixtureBytes() : null,
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final materialFinder = find.byKey(_bannerKey);
    expect(materialFinder, findsOneWidget);
    expect(find.text('离线缓存 · 点按刷新'), findsOneWidget);

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

    final tooltip = tester.widget<Tooltip>(
      find.descendant(
        of: materialFinder,
        matching: find.byType(Tooltip),
      ),
    );
    expect(tooltip.message, '点按刷新');
    expect(find.byTooltip('点按刷新'), findsOneWidget);

    // Under this Material only (not a global find.byType). InkWell inserts an
    // inner GestureDetector with onTap; skip those descendants. Tooltip's
    // detector must have onTap == null.
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
