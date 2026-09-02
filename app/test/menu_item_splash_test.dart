import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');

void main() {
  testWidgets(
      'mark-all-read PopupMenuItem theme splash is primary 0.12 / 0.08',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_markAllKey), findsOneWidget);

    final itemTheme = Theme.of(tester.element(find.byKey(_markAllKey)));
    final scheme = itemTheme.colorScheme;
    expect(itemTheme.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(itemTheme.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(itemTheme.hoverColor, scheme.primary.withValues(alpha: 0.08));
    expect(itemTheme.focusColor, scheme.primary.withValues(alpha: 0.08));

    final overflowFinder = find.byKey(_overflowKey);
    expect(overflowFinder, findsOneWidget);
    final button = tester.widget<PopupMenuButton<String>>(overflowFinder);
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
