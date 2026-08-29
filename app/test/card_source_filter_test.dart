import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _weiboBarKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');
const _normalKey = Key('event-card-same-day-normal-high-score');
const _breakingWeiboChipKey = Key('event-card-same-day-breaking-source-weibo');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

void main() {
  testWidgets(
      'card weibo chip applies source filter and does not open the url',
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

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_normalKey), findsOneWidget);
    expect(opened, isEmpty);

    await tester.ensureVisible(find.byKey(_breakingWeiboChipKey));
    await tester.tap(find.byKey(_breakingWeiboChipKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(_chip(tester, _weiboBarKey).selected, isTrue);
    expect(find.byKey(_normalKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);

    await tester.ensureVisible(find.byKey(_breakingWeiboChipKey));
    await tester.tap(find.byKey(_breakingWeiboChipKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(_chip(tester, _weiboBarKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_normalKey), findsOneWidget);
  });
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}
