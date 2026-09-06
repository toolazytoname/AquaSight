import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _feedLatestSnackKey = Key('feed-latest-snackbar');
const _t1 = '2026-08-26T01:00:00.000Z';

void main() {
  testWidgets(
      'feed-latest-snackbar surfaceTintColor is transparent; shadowColor transparent; elevation 3; floating; shape r8',
      (tester) async {
    _setDefaultSurface(tester);
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return _eventsJson(_t1, ['a']);
          },
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
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(_feedLatestSnackKey), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    expect(find.byKey(_feedLatestSnackKey), findsOneWidget);
    expect(find.text('已是最新'), findsOneWidget);

    final snackFinder = find.byKey(_feedLatestSnackKey);
    final snack = tester.widget<SnackBar>(snackFinder);
    expect((snack as dynamic).surfaceTintColor, Colors.transparent);
    expect((snack as dynamic).shadowColor, Colors.transparent);
    expect(snack.elevation, 3);
    expect(snack.behavior, SnackBarBehavior.floating);
    final shape = snack.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));

    final localTheme = tester.widget<Theme>(
      find.descendant(of: snackFinder, matching: find.byType(Theme)).first,
    );
    expect(localTheme.data.colorScheme.surfaceTint, Colors.transparent);

    final materialFinder =
        find.descendant(of: snackFinder, matching: find.byType(Material)).first;
    expect(
      Theme.of(tester.element(materialFinder)).colorScheme.surfaceTint,
      Colors.transparent,
    );
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

String _eventsJson(String updatedAt, List<String> ids) {
  return jsonEncode({
    'updatedAt': updatedAt,
    'sourceErrors': [],
    'items': [
      for (final id in ids)
        {
          'id': id,
          'title': 'Card $id',
          'url': 'https://example.com/$id',
          'source': 'hn',
          'level': 'normal',
          'reason': 'feed-latest-surface-tint',
          'score': 1,
          'publishedAt': updatedAt,
        },
    ],
  });
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
