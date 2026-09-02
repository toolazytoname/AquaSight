import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _overflowKey = Key('appbar-overflow');

void main() {
  testWidgets(
      'overflow PopupMenuButton style.shape is radius 8; overlay tokens stay',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    final overflowFinder = find.byKey(_overflowKey);
    expect(overflowFinder, findsOneWidget);

    final button = tester.widget<PopupMenuButton<String>>(overflowFinder);
    final styleShape = button.style!.shape!.resolve({});
    expect(styleShape, isA<RoundedRectangleBorder>());
    expect(
      (styleShape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );

    final scheme = Theme.of(tester.element(overflowFinder)).colorScheme;
    final overlayColor = button.style?.overlayColor;
    expect(overlayColor, isNotNull);
    expect(
      overlayColor!.resolve(const {WidgetState.pressed}),
      scheme.primary.withValues(alpha: 0.12),
    );
    expect(
      overlayColor.resolve(const {WidgetState.hovered}),
      scheme.primary.withValues(alpha: 0.08),
    );
    expect(
      overlayColor.resolve(const {WidgetState.focused}),
      scheme.primary.withValues(alpha: 0.08),
    );

    expect(button.shape, isA<RoundedRectangleBorder>());
    final panelShape = button.shape! as RoundedRectangleBorder;
    expect(panelShape.borderRadius, BorderRadius.circular(8));
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
