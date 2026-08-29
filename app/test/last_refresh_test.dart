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

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _refreshKey = Key('last-refresh');
const _bannerKey = Key('offline-banner');
const _searchKey = Key('timeline-search');
const _allFilterKey = Key('source-filter-all');
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingTimeKey = Key('event-card-same-day-breaking-time');

const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';
const _thirtySecondsAgo = '2026-08-26T01:59:30.000Z';
const _twoHoursAgo = '2026-08-26T00:00:00.000Z';
const _twoDaysAgo = '2026-08-24T02:00:00.000Z';

void main() {
  testWidgets(
      'loadLive success: 10分钟前更新, no offline-banner, below filters',
      (tester) async {
    await _pump(
      tester,
      repository: EventsRepository(
        loadLive: () async => _fixtureWithUpdatedAt(_tenMinutesAgo),
        loadCache: () async => throw StateError('must not read cache'),
        loadFallback: () async => throw StateError('must not read sibling'),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
    );

    expect(_refreshText(tester), '10分钟前更新');
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);

    final chips = tester.getTopLeft(find.byKey(_allFilterKey));
    final refresh = tester.getTopLeft(find.byKey(_refreshKey));
    final cards = tester.getTopLeft(find.byKey(_breakingKey));
    expect(chips.dy, lessThan(refresh.dy));
    expect(refresh.dy, lessThan(cards.dy));
    expect(tester.getTopLeft(find.byKey(_searchKey)).dy, lessThan(refresh.dy));
  });

  testWidgets(
      'loadLive fail to cache: 10分钟前更新 above 离线缓存',
      (tester) async {
    await _pump(
      tester,
      repository: EventsRepository(
        loadLive: () async => throw EventsLoadException('HTTP 503'),
        loadCache: () async => _fixtureWithUpdatedAt(_tenMinutesAgo),
        loadFallback: () async => throw StateError('must not read sibling'),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
    );

    expect(_refreshText(tester), '10分钟前更新');
    expect(find.byKey(_bannerKey), findsOneWidget);
    expect(find.text('离线缓存'), findsOneWidget);

    final refresh = tester.getTopLeft(find.byKey(_refreshKey));
    final banner = tester.getTopLeft(find.byKey(_bannerKey));
    final cards = tester.getTopLeft(find.byKey(_breakingKey));
    expect(refresh.dy, lessThan(banner.dy));
    expect(banner.dy, lessThan(cards.dy));
  });

  testWidgets('sibling fallback shows last-refresh above 离线缓存', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository(
        loadLive: () async => throw EventsLoadException('HTTP 503'),
        loadCache: () async => '',
        loadFallback: () async => _fixtureWithUpdatedAt(_tenMinutesAgo),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
    );

    expect(_refreshText(tester), '10分钟前更新');
    expect(find.text('离线缓存'), findsOneWidget);
    expect(
      tester.getTopLeft(find.byKey(_refreshKey)).dy,
      lessThan(tester.getTopLeft(find.byKey(_bannerKey)).dy),
    );
  });

  testWidgets('asset fallback shows last-refresh above 离线缓存', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository(
        loadLive: () async => throw EventsLoadException('HTTP 503'),
        loadCache: () async => '',
        loadFallback: () async => null,
        loadAsset: () async => _fixtureWithUpdatedAt(_tenMinutesAgo),
      ),
    );

    expect(_refreshText(tester), '10分钟前更新');
    expect(find.text('离线缓存'), findsOneWidget);
    expect(
      tester.getTopLeft(find.byKey(_refreshKey)).dy,
      lessThan(tester.getTopLeft(find.byKey(_bannerKey)).dy),
    );
  });

  testWidgets('default fixture updatedAt empty hides last-refresh',
      (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
    );

    expect(find.byKey(_refreshKey), findsNothing);
    expect(find.textContaining('更新'), findsNothing);
  });

  testWidgets('missing updatedAt hides last-refresh', (tester) async {
    final raw = loadFixtureJson();
    raw.remove('updatedAt');
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
    );

    expect(find.byKey(_refreshKey), findsNothing);
  });

  testWidgets('unparseable updatedAt hides last-refresh', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(
        _fixtureWithUpdatedAt('not-a-timestamp'),
      ),
    );

    expect(find.byKey(_refreshKey), findsNothing);
  });

  testWidgets('loading hides last-refresh', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () => Future<String>.delayed(
            const Duration(milliseconds: 50),
            () => _fixtureWithUpdatedAt(_tenMinutesAgo),
          ),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => _fixedNow,
      ),
    );

    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.byKey(_refreshKey), findsNothing);

    await tester.pumpAndSettle();
    expect(_refreshText(tester), '10分钟前更新');
  });

  testWidgets('error hides last-refresh', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository(
        loadLive: () async => throw EventsLoadException('网络不可用'),
        loadCache: () async => null,
        loadFallback: () async => null,
        loadAsset: () async => null,
      ),
    );

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(_refreshKey), findsNothing);
  });

  testWidgets('updatedAt 30s ago is 刚刚更新', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(
        _fixtureWithUpdatedAt(_thirtySecondsAgo),
      ),
    );

    expect(_refreshText(tester), '刚刚更新');
  });

  testWidgets('updatedAt 2 hours ago is 2小时前更新', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(
        _fixtureWithUpdatedAt(_twoHoursAgo),
      ),
    );

    expect(_refreshText(tester), '2小时前更新');
  });

  testWidgets('updatedAt 2 days ago is 2天前更新', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(
        _fixtureWithUpdatedAt(_twoDaysAgo),
      ),
    );

    expect(_refreshText(tester), '2天前更新');
  });

  testWidgets('empty items still shows last-refresh when updatedAt is valid',
      (tester) async {
    final raw = loadFixtureJson();
    raw['updatedAt'] = _tenMinutesAgo;
    raw['items'] = [];
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
    );

    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.byKey(_searchKey), findsNothing);
    expect(_refreshText(tester), '10分钟前更新');
  });

  testWidgets('T45 card copy stays 9小时前, not 9小时前更新', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(
        _fixtureWithUpdatedAt(_tenMinutesAgo),
      ),
    );

    expect(_refreshText(tester), '10分钟前更新');
    expect(
      tester.widget<Text>(find.byKey(_breakingTimeKey)).data,
      '9小时前',
    );
    expect(find.text('9小时前更新'), findsNothing);
  });

  testWidgets('last-refresh uses onSurfaceVariant', (tester) async {
    await _pump(
      tester,
      repository: EventsRepository.fromJsonString(
        _fixtureWithUpdatedAt(_tenMinutesAgo),
      ),
    );

    final scheme = Theme.of(
      tester.element(find.byKey(_refreshKey)),
    ).colorScheme;
    final text = tester.widget<Text>(find.byKey(_refreshKey));
    expect(text.style?.color, scheme.onSurfaceVariant);
  });
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  return jsonEncode(raw);
}

Future<void> _pump(
  WidgetTester tester, {
  required EventsRepository repository,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: repository,
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _fixedNow,
    ),
  );
  await tester.pumpAndSettle();
}

String _refreshText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_refreshKey)).data!;
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
