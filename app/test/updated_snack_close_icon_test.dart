import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _hitKey = Key('last-refresh-hit');
const _t1 = '2026-08-26T01:00:00.000Z';
const _t2 = '2026-08-26T02:00:00.000Z';

void main() {
  testWidgets(
      'feed-updated-snackbar closeIconColor is onInverseSurface',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var stamp = _t1;
    var ids = ['a'];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            return _eventsJson(stamp, ids);
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

    expect(find.byKey(const Key('event-card-a')), findsOneWidget);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    stamp = _t2;
    ids = ['a', 'b'];
    await tester.tap(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);

    final snack = tester.widget<SnackBar>(find.byKey(_feedUpdatedSnackKey));
    final scheme =
        Theme.of(tester.element(find.byKey(_feedUpdatedSnackKey))).colorScheme;
    expect(snack.closeIconColor, scheme.onInverseSurface);
    expect(snack.showCloseIcon, isTrue);
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.elevation, 3);
  });
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
          'reason': 'updated-snack-close-icon',
          'score': 1,
          'publishedAt': updatedAt,
        },
    ],
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
