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

const _countKey = Key('unread-count');
const _toggleKey = Key('unread-only-toggle');
const _searchKey = Key('timeline-search');
const _weiboKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets('fixture with all unread shows 未读 6', (tester) async {
    await _pumpFixture(tester);

    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 6');
    expect(find.byTooltip('只看未读'), findsOneWidget);
    expect(_toggle(tester).value, isFalse);
  });

  testWidgets('pre-seeded breaking stays 未读 5 under unread/source/search',
      (tester) async {
    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({'same-day-breaking'}),
    );

    expect(_countText(tester), '未读 5');

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isTrue);
    expect(_countText(tester), '未读 5');

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 5');

    await tester.enterText(find.byKey(_searchKey), 'english');
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 5');
    expect(find.byKey(_countKey), findsOneWidget);
  });

  testWidgets('all six read still shows 未读 0', (tester) async {
    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({..._allFixtureIds}),
    );

    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 0');
    expect(find.byTooltip('只看未读'), findsOneWidget);
  });

  testWidgets('empty items still shows 未读 0', (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 0');
  });

  testWidgets('tap unread-count does not open, share, or toggle',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          shared.add((title: title, url: url));
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_toggle(tester).value, isFalse);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('marking breaking read drops the count from 6 to 5 immediately',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: _forbidShare,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(_countText(tester), '未读 5');
  });

  testWidgets('loading state has no unread-count', (tester) async {
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
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.byKey(_countKey), findsNothing);

    await tester.pumpAndSettle();
    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('error state has no unread-count and does not fetch HTTP',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadFallback: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(_countKey), findsNothing);
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  ReadStore? readStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
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
