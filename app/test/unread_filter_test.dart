import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _toggleKey = Key('unread-only-toggle');
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets('default toggle is off and every fixture card is visible',
      (tester) async {
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

    expect(_toggle(tester).value, isFalse);
    expect(find.byTooltip('只看未读'), findsOneWidget);
    _expectAllFixtureCards();
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets('toggle on hides pre-seeded read cards and empty days',
      (tester) async {
    final store = ReadStore.memory({'same-day-breaking', 'unknown-date'});
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_breakingReadKey), findsOneWidget);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsOneWidget);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('同日破圈'), findsNothing);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);

    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
    expect(find.byKey(const Key('event-card-seen-only')), findsOneWidget);
    expect(find.byKey(const Key('event-card-missing-title-zh')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-26')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('all-read filter shows 暂无未读 empty, not error; off restores cards',
      (tester) async {
    final store = ReadStore.memory({..._allFixtureIds});
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    _expectAllFixtureCards();
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length));

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
    expect(find.text('加载失败'), findsNothing);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }
    expect(find.byKey(const Key('day-group-2026-08-26')), findsNothing);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsNothing);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsNothing);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    _expectAllFixtureCards();
    expect(find.text('暂无未读'), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length));
  });

  testWidgets('new AquaApp keeps unread toggle and seeded 已读 marks',
      (tester) async {
    final store = ReadStore.memory({'same-day-breaking'});
    final unreadOnly = UnreadOnlyStore.memory();
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: store,
        unreadOnlyStore: unreadOnly,
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);

    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        readStore: store,
        unreadOnlyStore: unreadOnly,
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
  });

  testWidgets('filter on: successful tap hides that card immediately',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_breakingKey), findsOneWidget);

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.text('同日破圈'), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets('source-empty feed keeps 暂无事件 even with the filter on',
      (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

void _expectAllFixtureCards() {
  for (final id in _allFixtureIds) {
    expect(find.byKey(Key('event-card-$id')), findsOneWidget);
  }
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
