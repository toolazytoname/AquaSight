import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _errorKey = Key('timeline-error');
const _retryKey = Key('timeline-error-retry');
const _toggleKey = Key('unread-only-toggle');
const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');
const _englishKey = Key('event-card-missing-title-zh');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

ReadStore _allReadExceptBreaking() {
  return ReadStore.memory({
    for (final id in _allFixtureIds)
      if (id != 'same-day-breaking') id,
  });
}

void main() {
  testWidgets(
      'memory(weibo) first loadLive throw stays on timeline-error without chips',
      (tester) async {
    final store = SourceFilterStore.memory('weibo');
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      sourceFilter: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_weiboKey), findsNothing);
    expect(find.byKey(_allKey), findsNothing);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(store.value, 'weibo');
  });

  testWidgets(
      'retry after first-load failure restores persisted weibo source filter',
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
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsNothing);
    expect(find.byKey(const Key('event-card-seen-only')), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);
    expect(find.byKey(_errorKey), findsNothing);
    expect(store.value, 'weibo');
  });

  testWidgets(
      'retry after first-load failure restores persisted unread-only',
      (tester) async {
    final store = UnreadOnlyStore.memory(true);
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      readStore: _allReadExceptBreaking(),
      unreadOnly: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(_toggle(tester).value, isTrue);

    await tester.tap(find.byKey(_retryKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsNothing);
    expect(find.byKey(const Key('event-card-seen-only')), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);
    expect(find.byKey(_errorKey), findsNothing);
    expect(store.value, isTrue);
  });

  testWidgets(
      'error-page unread flip to false wins over persisted true after retry',
      (tester) async {
    final store = UnreadOnlyStore.memory(true);
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      readStore: _allReadExceptBreaking(),
      unreadOnly: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(_toggle(tester).value, isTrue);

    // Error page now shows the persisted on switch. Flip off so the session
    // toggle wins over store restore on retry.
    await tester.tap(find.byKey(_toggleKey));
    await tester.pump();
    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_retryKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
    expect(find.byKey(const Key('event-card-seen-only')), findsOneWidget);
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-unknown-date')), findsOneWidget);
    expect(find.byKey(_errorKey), findsNothing);
  });

  testWidgets(
      'T97 retry after first-load failure still restores persisted title search',
      (tester) async {
    final store = TitleSearchStore.memory('破圈');
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      titleSearch: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_searchKey), findsNothing);

    await tester.tap(find.byKey(_retryKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsNothing);
    expect(find.byKey(const Key('event-card-seen-only')), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);
    expect(find.byKey(_errorKey), findsNothing);
    expect(store.value, '破圈');
  });
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
  ReadStore? readStore,
  UnreadOnlyStore? unreadOnly,
  SourceFilterStore? sourceFilter,
  TitleSearchStore? titleSearch,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: repository,
      openUrl: _forbidLaunch,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: unreadOnly ?? UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilter ?? SourceFilterStore.memory(),
      titleSearchStore: titleSearch ?? TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
