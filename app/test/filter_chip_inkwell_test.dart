import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');

void main() {
  testWidgets(
      'named source FilterChip uses InkWell long-press; 全部 has no copy InkWell',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(tester);

    await tester.ensureVisible(find.byKey(_weiboKey));

    final allInkWells = find.ancestor(
      of: find.byKey(_allKey),
      matching: find.byType(InkWell),
    );
    for (final element in allInkWells.evaluate()) {
      expect((element.widget as InkWell).onLongPress, isNull);
    }

    final weiboFinder = find.byKey(_weiboKey);
    expect(weiboFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(
      find
          .ancestor(
            of: weiboFinder,
            matching: find.byType(InkWell),
          )
          .first,
    );
    final scheme = Theme.of(tester.element(weiboFinder)).colorScheme;
    expect(inkWell.onTap, isNotNull);
    expect(inkWell.onLongPress, isNotNull);
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.hoverColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.focusColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.customBorder, isA<RoundedRectangleBorder>());
    expect(
      (inkWell.customBorder as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );

    final wrappingDetectors = find.ancestor(
      of: weiboFinder,
      matching: find.byType(GestureDetector),
    );
    final nearestInkWell = find
        .ancestor(
          of: weiboFinder,
          matching: find.byType(InkWell),
        )
        .first;
    for (final element in wrappingDetectors.evaluate()) {
      final insideInkWell = find
          .descendant(
            of: nearestInkWell,
            matching: find.byWidget(element.widget),
          )
          .evaluate()
          .isNotEmpty;
      expect(
        insideInkWell,
        isTrue,
        reason: 'source-filter-weibo must not have a wrapping GestureDetector',
      );
    }
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
