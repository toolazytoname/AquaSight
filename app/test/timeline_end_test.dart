import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _endKey = Key('timeline-end');
const _emptyKey = Key('timeline-empty');
const _overflowKey = Key('appbar-overflow');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets('default fixture all unread: timeline-end is 没有更多了',
      (tester) async {
    await _pumpFixture(tester);

    expect(find.byKey(_endKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_endKey)).data, '没有更多了');
    expect(find.text('已全部看完'), findsNothing);

    final theme = Theme.of(tester.element(find.byKey(_endKey)));
    final text = tester.widget<Text>(find.byKey(_endKey));
    expect(text.style?.fontSize, theme.textTheme.bodySmall?.fontSize);
    expect(text.style?.color, theme.colorScheme.onSurfaceVariant);
    expect(text.textAlign, TextAlign.center);
  });

  testWidgets('all six ids read: timeline-end is 已全部看完; no overflow',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory({..._allFixtureIds}),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_endKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_endKey)).data, '已全部看完');
    expect(find.text('没有更多乮'), findsNothing);
    expect(find.text('没有更多了'), findsNothing);
    expect(find.byKey(_overflowKey), findsNothing);
  });

  testWidgets('empty items: timeline-empty only; no timeline-end',
      (tester) async {
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

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_endKey), findsNothing);
  });

  testWidgets(
      'unread-only + all six ids read: 暂无未读 empty; no timeline-end',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory({..._allFixtureIds}),
        unreadOnlyStore: UnreadOnlyStore.memory(true),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.byKey(_endKey), findsNothing);
  });
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
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
