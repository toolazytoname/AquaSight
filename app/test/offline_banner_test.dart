import 'dart:async';

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
const _searchKey = Key('timeline-search');
const _weiboKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets('loadLive success never shows the offline banner', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => loadFixtureBytes(),
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('fromJsonString is live and hides the banner', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
  });

  testWidgets('live fail with cache data shows the banner above cards',
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
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    _expectBannerPresent();
    expect(find.byKey(_breakingKey), findsOneWidget);
    _expectBannerBelowFiltersAboveCards(tester);
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.byKey(_bannerKey)),
      findsNothing,
    );
  });

  testWidgets('live fail with sibling data (cache empty) shows the banner',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('HTTP 503'),
          loadCache: () async => '',
          loadFallback: () async => loadFixtureBytes(),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    _expectBannerPresent();
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets(
      'live fail with empty cache/sibling and asset data shows the banner',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('HTTP 503'),
          loadCache: () async => '',
          loadFallback: () async => null,
          loadAsset: () async => loadFixtureBytes(),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    _expectBannerPresent();
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('live factory with forbidHttp cache is offline, not network',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.live(
          httpGet: forbidHttp,
          fallbackFiles: [],
          loadCache: () async => loadFixtureBytes(),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    _expectBannerPresent();
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('offline then refresh to live hides the banner', (tester) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        if (loads == 1) throw EventsLoadException('HTTP 503');
        return loadFixtureBytes();
      },
      loadCache: () async => loads == 1 ? loadFixtureBytes() : null,
      loadFallback: () async => null,
      loadAsset: () async => null,
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    _expectBannerPresent();
    expect(find.byKey(_breakingKey), findsOneWidget);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    await tester.pumpAndSettle();
    await refresh;

    expect(loads, 2);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('filtered empty list still shows the offline banner',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('HTTP 503'),
          loadCache: () async => loadFixtureBytes(),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    _expectBannerPresent();

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    _expectBannerPresent();
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_searchKey), findsOneWidget);
    expect(find.byKey(_weiboKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);

    final banner = tester.getTopLeft(find.byKey(_bannerKey));
    final search = tester.getTopLeft(find.byKey(_searchKey));
    final empty = tester.getTopLeft(find.byKey(const Key('timeline-empty')));
    expect(search.dy, lessThan(banner.dy));
    expect(banner.dy, lessThan(empty.dy));
  });

  testWidgets('does not show the banner while loading', (tester) async {
    final repo = EventsRepository(
      loadLive: () => Future<String>.delayed(
        const Duration(milliseconds: 50),
        loadFixtureBytes,
      ),
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.byKey(const Key('timeline-error-retry')), findsNothing);
    await tester.pumpAndSettle();
    expect(find.byKey(_bannerKey), findsNothing);
  });

  testWidgets('does not show the banner on error', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.text('加载失败'), findsOneWidget);
  });

  testWidgets('tapping the offline banner retries live and hides on success',
      (tester) async {
    var loads = 0;
    var opened = 0;
    var shared = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        if (loads == 1) throw EventsLoadException('HTTP 503');
        return loadFixtureBytes();
      },
      loadCache: () async => loads == 1 ? loadFixtureBytes() : null,
      loadFallback: () async => null,
      loadAsset: () async => null,
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: (uri) async => opened++,
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async =>
            shared++,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    _expectBannerPresent();
    expect(loads, 1);

    await tester.tap(find.byKey(_bannerKey));
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(opened, 0);
    expect(shared, 0);
  });

  testWidgets(
      'tapping the banner while a refresh is running does not stack loadLive',
      (tester) async {
    var loads = 0;
    final hang = Completer<String>();
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        if (loads == 1) throw EventsLoadException('HTTP 503');
        return hang.future;
      },
      loadCache: () async => loads == 1 ? loadFixtureBytes() : null,
      loadFallback: () async => null,
      loadAsset: () async => null,
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    _expectBannerPresent();
    expect(loads, 1);

    await tester.tap(find.byKey(_bannerKey));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(loads, 2);

    await tester.tap(find.byKey(_bannerKey));
    await tester.pump();
    expect(loads, 2);

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_bannerKey), findsNothing);
  });
}

void _expectBannerPresent() {
  expect(find.byKey(_bannerKey), findsOneWidget);
  expect(find.text('离线缓存 · 点按刷新'), findsOneWidget);
}

void _expectBannerBelowFiltersAboveCards(WidgetTester tester) {
  final search = tester.getTopLeft(find.byKey(_searchKey));
  final chips = tester.getTopLeft(find.byKey(const Key('source-filter-all')));
  final banner = tester.getTopLeft(find.byKey(_bannerKey));
  final cards = tester.getTopLeft(find.byKey(_breakingKey));
  expect(search.dy, lessThan(banner.dy));
  expect(chips.dy, lessThan(banner.dy));
  expect(banner.dy, lessThan(cards.dy));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
