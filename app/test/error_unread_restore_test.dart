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

const _errorKey = Key('timeline-error');
const _retryKey = Key('timeline-error-retry');
const _toggleKey = Key('unread-only-toggle');
const _breakingKey = Key('event-card-same-day-breaking');

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
      'memory(true) first loadLive throw paints unread-only on timeline-error',
      (tester) async {
    final store = UnreadOnlyStore.memory(true);
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      unreadOnly: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(_toggle(tester).value, isTrue);
    expect(store.value, isTrue);
  });

  testWidgets(
      'memory(false) first loadLive throw paints unread-only off on timeline-error',
      (tester) async {
    final store = UnreadOnlyStore.memory(false);
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      unreadOnly: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(_toggle(tester).value, isFalse);
    expect(store.value, isFalse);
  });

  testWidgets(
      'T98 error-page unread flip to false still wins after retry',
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
    expect(find.byKey(const Key('event-card-missing-title-zh')), findsOneWidget);
    expect(find.byKey(const Key('event-card-unknown-date')), findsOneWidget);
    expect(find.byKey(_errorKey), findsNothing);
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
  required UnreadOnlyStore unreadOnly,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: repository,
      openUrl: _forbidLaunch,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: unreadOnly,
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
