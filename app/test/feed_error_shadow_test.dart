import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _errorSnackKey = Key('feed-error-snackbar');
const _retryKey = Key('feed-error-retry');
const _updatedA = '2026-08-26T01:00:00.000Z';
const _refreshFail = '刷新失败：源不可用';

void main() {
  testWidgets(
      'feed-error-snackbar shadowColor is transparent; elevation 3; floating; shape r8',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return _fixtureWithUpdatedAt(_updatedA);
            throw EventsLoadException(_refreshFail);
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();
    await refresh;

    expect(find.byKey(_errorSnackKey), findsOneWidget);
    expect(find.byKey(_retryKey), findsOneWidget);

    final snackFinder = find.byKey(_errorSnackKey);
    final snack = tester.widget<SnackBar>(snackFinder);
    expect((snack as dynamic).shadowColor, Colors.transparent);
    expect(snack.elevation, 3);
    expect(snack.behavior, SnackBarBehavior.floating);
    final shape = snack.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));

    expect(find.byKey(_retryKey), findsOneWidget);
    expect(snack.action, isA<SnackBarAction>());
    expect(tester.widget<SnackBarAction>(find.byKey(_retryKey)), isNotNull);

    final localTheme = tester.widget<Theme>(
      find.descendant(of: snackFinder, matching: find.byType(Theme)).first,
    );
    expect(localTheme.data.shadowColor, Colors.transparent);
    expect(localTheme.data.colorScheme.shadow, Colors.transparent);

    final materialFinder =
        find.descendant(of: snackFinder, matching: find.byType(Material)).first;
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

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  return jsonEncode(raw);
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
