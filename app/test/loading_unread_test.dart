import 'dart:async';

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

const _loadingKey = Key('timeline-loading');
const _errorKey = Key('timeline-error');
const _toggleKey = Key('unread-only-toggle');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'memory(true) paints unread-only on during timeline-loading',
      (tester) async {
    final hang = Completer<String>();
    final store = UnreadOnlyStore.memory(true);
    await _pumpHungApp(tester, repository: _hungRepo(hang), unreadOnly: store);

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(_toggle(tester).value, isTrue);

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();

    expect(find.byKey(_loadingKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(_toggle(tester).value, isTrue);
    expect(store.value, isTrue);
  });

  testWidgets(
      'memory(false) paints unread-only off during timeline-loading',
      (tester) async {
    final hang = Completer<String>();
    final store = UnreadOnlyStore.memory(false);
    await _pumpHungApp(tester, repository: _hungRepo(hang), unreadOnly: store);

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(_toggle(tester).value, isFalse);

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();

    expect(find.byKey(_loadingKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(_toggle(tester).value, isFalse);
    expect(store.value, isFalse);
  });

  testWidgets(
      'memory(true) first loadLive throw still paints unread-only on timeline-error',
      (tester) async {
    final store = UnreadOnlyStore.memory(true);
    await tester.pumpWidget(
      AquaApp(
        repository: _failThenFixture(),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: store,
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
        titleSearchStore: TitleSearchStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(_toggle(tester).value, isTrue);
    expect(store.value, isTrue);
  });

  testWidgets(
      'toggle off during timeline-loading wins after load completes',
      (tester) async {
    final hang = Completer<String>();
    final store = UnreadOnlyStore.memory(true);
    await _pumpHungApp(tester, repository: _hungRepo(hang), unreadOnly: store);

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(_toggle(tester).value, isTrue);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pump();
    expect(_toggle(tester).value, isFalse);
    expect(store.value, isFalse);

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    expect(store.value, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });
}

EventsRepository _hungRepo(Completer<String> hang) {
  return EventsRepository(
    loadLive: () => hang.future,
    loadFallback: () async => null,
  );
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

Future<void> _pumpHungApp(
  WidgetTester tester, {
  required EventsRepository repository,
  required UnreadOnlyStore unreadOnly,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: repository,
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: unreadOnly,
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: TitleSearchStore.memory(),
    ),
  );
  await tester.pump();
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
