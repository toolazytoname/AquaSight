import 'dart:async';
import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _loadingKey = Key('timeline-loading');
const _errorKey = Key('timeline-error');
const _retryKey = Key('timeline-error-retry');
const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
const _hnKey = Key('source-filter-Hacker News');
const _breakingKey = Key('event-card-same-day-breaking');
const _crossMidnightKey = Key('event-card-cross-midnight');
const _normalKey = Key('event-card-same-day-normal-high-score');
const _seenOnlyKey = Key('event-card-seen-only');
const _englishKey = Key('event-card-missing-title-zh');
const _unknownDateKey = Key('event-card-unknown-date');

void main() {
  testWidgets(
      'hung weibo load stays on timeline-loading; first list frame is weibo',
      (tester) async {
    final hang = Completer<void>();
    final store = _hangableMemory('weibo', hang);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: store,
        titleSearchStore: TitleSearchStore.memory(),
      ),
    );
    await tester.pump();

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(find.byKey(_allKey), findsNothing);
    expect(find.byKey(_weiboKey), findsNothing);
    _expectNoEventCards();

    hang.complete();
    await _pumpUntilFirstListFrame(tester);

    expect(find.byKey(_loadingKey), findsNothing);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_crossMidnightKey), findsNothing);
    expect(find.byKey(_normalKey), findsNothing);
    expect(find.byKey(_seenOnlyKey), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(_unknownDateKey), findsNothing);
    expect(store.value, 'weibo');
  });

  testWidgets(
      'T76 cold-start success still selects Hacker News on the first settled frame',
      (tester) async {
    await _pumpApp(
      tester,
      repository: EventsRepository.fromJsonString(_fixtureWithHackerNews()),
      sourceFilter: SourceFilterStore.memory('Hacker News'),
    );

    expect(_chip(tester, _hnKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(_crossMidnightKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets(
      'T98 first-load-fail then retry still restores persisted weibo',
      (tester) async {
    final store = SourceFilterStore.memory('weibo');
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      sourceFilter: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_weiboKey), findsNothing);

    await tester.tap(find.byKey(_retryKey));
    await tester.pumpAndSettle();

    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_crossMidnightKey), findsNothing);
    expect(find.byKey(_normalKey), findsNothing);
    expect(find.byKey(_seenOnlyKey), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(_unknownDateKey), findsNothing);
    expect(find.byKey(_errorKey), findsNothing);
    expect(store.value, 'weibo');
  });
}

/// [SourceFilterStore.memory] whose [load] waits on [hang].
SourceFilterStore _hangableMemory(String? seed, Completer<void> hang) {
  final memory = SourceFilterStore.memory(seed);
  return SourceFilterStore(
    loadValue: () async {
      await hang.future;
      return memory.load();
    },
    saveValue: memory.save,
  );
}

/// Pump one frame at a time so a 「全部 then weibo」 flash would fail here.
Future<void> _pumpUntilFirstListFrame(WidgetTester tester) async {
  for (var i = 0; i < 20; i++) {
    await tester.pump();
    if (find.byKey(_weiboKey).evaluate().isEmpty) {
      expect(find.byKey(_allKey), findsNothing);
      _expectNoEventCards();
      continue;
    }
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    return;
  }
  fail('list never left timeline-loading after source load completed');
}

void _expectNoEventCards() {
  expect(find.byKey(_breakingKey), findsNothing);
  expect(find.byKey(_crossMidnightKey), findsNothing);
  expect(find.byKey(_normalKey), findsNothing);
  expect(find.byKey(_seenOnlyKey), findsNothing);
  expect(find.byKey(_englishKey), findsNothing);
  expect(find.byKey(_unknownDateKey), findsNothing);
}

String _fixtureWithHackerNews() {
  final raw = loadFixtureJson();
  for (final row in raw['items'] as List) {
    if (row is Map && row['source'] == 'hn') {
      row['source'] = 'Hacker News';
    }
  }
  return jsonEncode(raw);
}

EventsRepository _failThenFixture() {
  var loads = 0;
  return EventsRepository(
    loadLive: () async {
      loads++;
      if (loads == 1) {
        throw EventsLoadException('网络不可用');
      }
      return loadFixtureBytes();
    },
    loadFallback: () async => null,
  );
}

Future<void> _pumpApp(
  WidgetTester tester, {
  required EventsRepository repository,
  required SourceFilterStore sourceFilter,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: repository,
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilter,
      titleSearchStore: TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
