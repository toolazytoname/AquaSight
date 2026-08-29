import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _bannerKey = Key('offline-banner');

void main() {
  testWidgets(
      'offline-banner is full-row 48px; tap right edge retries live',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) throw EventsLoadException('HTTP 503');
            return loadFixtureBytes();
          },
          loadCache: () async => loads == 1 ? loadFixtureBytes() : null,
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_bannerKey), findsOneWidget);
    expect(find.text('离线缓存'), findsOneWidget);
    expect(find.byTooltip('点按刷新'), findsOneWidget);
    expect(loads, 1);

    expect(
      tester.getSize(find.byKey(_bannerKey)).height,
      greaterThanOrEqualTo(48),
    );

    await tester.tapAt(
      tester.getTopRight(find.byKey(_bannerKey)) + const Offset(-8, 24),
    );
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
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
