import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingShareKey = Key('event-card-same-day-breaking-share');

void main() {
  testWidgets(
      'share IconButton overlay uses theme primary splash 0.12 / 0.08',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(tester);

    final shareFinder = find.byKey(_breakingShareKey);
    expect(shareFinder, findsOneWidget);

    final buttonFinder = find.descendant(
      of: shareFinder,
      matching: find.byType(IconButton),
    );
    expect(buttonFinder, findsOneWidget);

    final button = tester.widget<IconButton>(buttonFinder);
    final scheme = Theme.of(tester.element(buttonFinder)).colorScheme;
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

    expect(find.byTooltip('分享'), findsOneWidget);
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
