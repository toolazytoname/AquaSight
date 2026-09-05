import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _scrollKey = Key('timeline-scroll');
const _feedLatestSnackKey = Key('feed-latest-snackbar');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _updatedA = '2026-08-26T01:00:00.000Z';

void main() {
  testWidgets(
      'feed-latest-snackbar closeIconColor is onInverseSurface',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var loads = 0;
    const stamp = _updatedA;
    final store = ScrollOffsetStore.memory(120);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return _fixtureWithUpdatedAt(stamp);
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: store,
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_scrollKey), findsOneWidget);
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    expect(find.byKey(_feedLatestSnackKey), findsOneWidget);
    expect(find.text('已是最新'), findsOneWidget);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    final snack = tester.widget<SnackBar>(find.byKey(_feedLatestSnackKey));
    final scheme =
        Theme.of(tester.element(find.byKey(_feedLatestSnackKey))).colorScheme;
    expect(snack.closeIconColor, scheme.onInverseSurface);
    expect(snack.showCloseIcon, isTrue);
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.elevation, 3);
  });
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  return jsonEncode(raw);
}

Future<void> _pullReload(WidgetTester tester) async {
  final refresh = tester
      .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
      .show();
  await tester.pumpAndSettle();
  await refresh;
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
