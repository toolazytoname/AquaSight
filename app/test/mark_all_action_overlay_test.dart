import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');
const _snackKey = Key('mark-all-read-snackbar');
const _undoKey = Key('mark-all-undo');

void main() {
  testWidgets(
      'mark-all-undo SnackBarAction overlay comes from local textButtonTheme',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_snackKey), findsOneWidget);
    expect(find.byKey(_undoKey), findsOneWidget);

    final undoFinder = find.byKey(_undoKey);
    final theme = Theme.of(tester.element(undoFinder));
    final scheme = theme.colorScheme;
    final overlayColor = theme.textButtonTheme.style!.overlayColor;
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
    expect(overlayColor.resolve(const {}), isNull);
  });
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
