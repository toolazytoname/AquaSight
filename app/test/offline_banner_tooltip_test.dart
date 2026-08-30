import 'dart:convert';

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
const _refreshKey = Key('last-refresh');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'live fail + cache: 离线缓存 has 点按刷新 tooltip; tap retries loadLive',
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
    expect(find.text('离线缓存 · 点按刷新'), findsOneWidget);
    expect(find.byTooltip('点按刷新'), findsOneWidget);
    expect(find.byTooltip('下一条未读'), findsOneWidget);
    expect(loads, 1);

    await tester.tap(find.byKey(_bannerKey));
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.byTooltip('点按刷新'), findsNothing);
  });

  testWidgets('live success has no offline-banner and no 点按刷新 tooltip',
      (tester) async {
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
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.byTooltip('点按刷新'), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byTooltip('下一条未读'), findsOneWidget);
  });

  testWidgets('last-refresh has no 点按刷新 tooltip; tap retries loadLive',
      (tester) async {
    var loads = 0;
    final raw = loadFixtureJson();
    raw['updatedAt'] = '2026-08-26T01:50:00.000Z';
    final cached = jsonEncode(raw);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            throw EventsLoadException('HTTP 503');
          },
          loadCache: () async => cached,
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => DateTime.parse('2026-08-26T02:00:00.000Z'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_refreshKey), findsOneWidget);
    expect(find.text('离线缓存 · 点按刷新'), findsOneWidget);
    expect(find.byTooltip('点按刷新'), findsOneWidget);
    expect(
      find.ancestor(
        of: find.byKey(_refreshKey),
        matching: find.byTooltip('点按刷新'),
      ),
      findsNothing,
    );
    expect(loads, 1);

    await tester.tap(find.byKey(_refreshKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_refreshKey), findsOneWidget);
    expect(find.byKey(_bannerKey), findsOneWidget);
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
