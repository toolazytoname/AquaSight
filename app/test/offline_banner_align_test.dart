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
      'live fail + cache: 离线缓存 is vertically centered and left-aligned',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('HTTP 503'),
          loadCache: () async => loadFixtureBytes(),
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

    expect(
      tester.getSize(find.byKey(_bannerKey)).height,
      greaterThanOrEqualTo(48),
    );

    final banner = tester.getRect(find.byKey(_bannerKey));
    final text = tester.getRect(find.text('离线缓存'));
    expect(
      (banner.center.dy - text.center.dy).abs(),
      lessThanOrEqualTo(2),
    );
    expect(text.left, greaterThanOrEqualTo(banner.left + 16 - 1));
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
