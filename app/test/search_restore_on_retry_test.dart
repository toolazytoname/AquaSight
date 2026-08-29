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

const _searchKey = Key('timeline-search');
const _errorKey = Key('timeline-error');
const _retryKey = Key('timeline-error-retry');
const _breakingKey = Key('event-card-same-day-breaking');
const _englishKey = Key('event-card-missing-title-zh');

void main() {
  testWidgets(
      'memory(破圈) first loadLive throw stays on timeline-error without search',
      (tester) async {
    final store = TitleSearchStore.memory('破圈');
    await _pumpApp(
      tester,
      repository: _failThenFixture(),
      titleSearch: store,
    );

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_searchKey), findsNothing);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(store.value, '破圈');
  });

  testWidgets(
      'retry after first-load failure restores persisted title search',
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

  testWidgets(
      'T96 cold-start success still paints 破圈 and 同日破圈',
      (tester) async {
    await _pumpApp(
      tester,
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      titleSearch: TitleSearchStore.memory('破圈'),
    );

    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
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
  required TitleSearchStore titleSearch,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: repository,
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: titleSearch,
    ),
  );
  await tester.pumpAndSettle();
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
