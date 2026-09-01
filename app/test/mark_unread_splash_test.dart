import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingMarkUnreadKey = Key('event-card-same-day-breaking-mark-unread');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

void main() {
  testWidgets(
      'mark-unread is InkWell with theme primary splash; no wrapping onTap GestureDetector',
      (tester) async {
    _setPhoneSurface(tester);
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory({'same-day-breaking'});
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent:
            ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final hitFinder = find.byKey(_breakingMarkUnreadKey);
    expect(hitFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(hitFinder);
    final scheme = Theme.of(tester.element(hitFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);

    final tooltip = tester.widget<Tooltip>(
      find.ancestor(
        of: find.byKey(_breakingReadKey),
        matching: find.byType(Tooltip),
      ),
    );
    expect(tooltip.message, '标为未读');

    // Ancestors of 已读 only (not a global find.byType). InkWell
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
      of: find.byKey(_breakingReadKey),
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

    await tester.tap(hitFinder);
    await tester.pumpAndSettle();

    expect(find.text('已读'), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.byKey(_breakingMarkUnreadKey), findsNothing);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(opened, isEmpty);
    expect(shared, isEmpty);
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}
