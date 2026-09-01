import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _weiboChipKey = Key('event-card-same-day-breaking-source-weibo');

void main() {
  testWidgets(
      'source chip is InkWell with theme primary splash; no wrapping onTap GestureDetector',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpBreaking(tester);

    final hitFinder = find.byKey(_weiboChipKey);
    expect(hitFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(hitFinder);
    final scheme = Theme.of(tester.element(hitFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);
    expect(inkWell.onLongPress, isNotNull);

    final tooltip = tester.widget<Tooltip>(
      find.ancestor(
        of: hitFinder,
        matching: find.byType(Tooltip),
      ),
    );
    expect(tooltip.message, '筛选此来源');

    final hitSize = tester.getSize(hitFinder);
    expect(hitSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(hitSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));

    // Ancestors of the chip key (not a global find.byType). InkWell
    // inserts an inner GestureDetector with onTap; skip those descendants.
    // Tooltip's detector must have onTap == null. The card-open InkWell
    // also inserts a GestureDetector ancestor; leftover — skip it by
    // inspecting only detectors under this local Material.
    final localMaterial = find
        .ancestor(
          of: hitFinder,
          matching: find.byWidgetPredicate(
            (widget) => widget is Material && widget.color == Colors.transparent,
          ),
        )
        .first;
    final gestureDetectors = find.ancestor(
      of: hitFinder,
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
      final underLocalMaterial = find
          .descendant(
            of: localMaterial,
            matching: find.byWidget(element.widget),
          )
          .evaluate()
          .isNotEmpty;
      if (!underLocalMaterial) continue;
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

Future<void> _pumpBreaking(WidgetTester tester) async {
  final raw = loadFixtureJson();
  final item = (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
        (row) => row['id'] == 'same-day-breaking',
      );
  item['sources'] = [
    (item['sources'] as List).cast<Map<String, dynamic>>().firstWhere(
          (source) => source['source'] == 'weibo',
        ),
  ];
  raw['items'] = [item];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: (_) async {},
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
