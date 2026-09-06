import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/timeline_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _exitSnackKey = Key('exit-confirm-snackbar');

void main() {
  testWidgets(
    'exit-confirm-snackbar shadowColor is transparent; default fixed (not floating); duration exitConfirmWindow',
    (tester) async {
      _setDefaultSurface(tester);
      await _pumpApp(tester);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.byKey(_exitSnackKey), findsOneWidget);
      expect(find.text('再按一次退出'), findsOneWidget);

      final snackFinder = find.byKey(_exitSnackKey);
      final snack = tester.widget<SnackBar>(snackFinder);
      expect((snack as dynamic).shadowColor, Colors.transparent);
      expect(find.text('再按一次退出'), findsOneWidget);
      expect(snack.duration, exitConfirmWindow);
      expect(snack.behavior, isNot(SnackBarBehavior.floating));

      final localTheme = tester.widget<Theme>(
        find.descendant(of: snackFinder, matching: find.byType(Theme)).first,
      );
      expect(localTheme.data.shadowColor, Colors.transparent);
      expect(localTheme.data.colorScheme.shadow, Colors.transparent);

      final materialFinder = find
          .descendant(of: snackFinder, matching: find.byType(Material))
          .first;
      expect(
        Theme.of(tester.element(materialFinder)).shadowColor,
        Colors.transparent,
      );
      expect(
        Theme.of(tester.element(materialFinder)).colorScheme.shadow,
        Colors.transparent,
      );
    },
  );
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpApp(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async => loadFixtureBytes(),
        loadCache: () async => throw StateError('must not read cache'),
        loadFallback: () async => throw StateError('must not read sibling'),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: TitleSearchStore.memory(),
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
