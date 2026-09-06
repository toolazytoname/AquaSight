import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _markAllSnackKey = Key('mark-all-read-snackbar');
const _undoKey = Key('mark-all-undo');
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');

void main() {
  testWidgets(
      'mark-all-read-snackbar surfaceTintColor is transparent; shadowColor transparent; elevation 3; floating; shape r8',
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

    expect(find.byKey(_markAllSnackKey), findsOneWidget);
    expect(find.byKey(_undoKey), findsOneWidget);

    final snackFinder = find.byKey(_markAllSnackKey);
    final snack = tester.widget<SnackBar>(snackFinder);
    expect((snack as dynamic).surfaceTintColor, Colors.transparent);
    expect((snack as dynamic).shadowColor, Colors.transparent);
    expect(snack.elevation, 3);
    expect(snack.behavior, SnackBarBehavior.floating);
    final shape = snack.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));

    expect(find.byKey(_undoKey), findsOneWidget);
    expect(snack.action, isA<SnackBarAction>());
    expect(tester.widget<SnackBarAction>(find.byKey(_undoKey)), isNotNull);

    final localTheme = tester.widget<Theme>(
      find.descendant(of: snackFinder, matching: find.byType(Theme)).first,
    );
    expect(localTheme.data.colorScheme.surfaceTint, Colors.transparent);
    expect(localTheme.data.shadowColor, Colors.transparent);
    expect(localTheme.data.colorScheme.shadow, Colors.transparent);

    final materialFinder =
        find.descendant(of: snackFinder, matching: find.byType(Material)).first;
    expect(
      Theme.of(tester.element(materialFinder)).colorScheme.surfaceTint,
      Colors.transparent,
    );
    expect(
      Theme.of(tester.element(materialFinder)).shadowColor,
      Colors.transparent,
    );
    expect(
      Theme.of(tester.element(materialFinder)).colorScheme.shadow,
      Colors.transparent,
    );
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
