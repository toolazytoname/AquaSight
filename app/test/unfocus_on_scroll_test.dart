import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _scrollKey = Key('timeline-scroll');
const _clearKey = Key('timeline-search-clear');
const _toggleKey = Key('unread-only-toggle');
const _weiboKey = Key('source-filter-weibo');
const _englishKey = Key('event-card-missing-title-zh');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'tap timeline-search then drag timeline-scroll unfocuses; text and hits stay',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    await tester.tap(find.byKey(_searchKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);

    await tester.enterText(find.byKey(_searchKey), 'e');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, 'e');
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
    expect(find.byKey(const Key('event-card-seen-only')), findsOneWidget);
    expect(find.byKey(const Key('event-card-unknown-date')), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);

    await tester.drag(find.byKey(_scrollKey), const Offset(0, -280));
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
    expect(_searchField(tester).controller!.text, 'e');
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
    expect(find.byKey(const Key('event-card-seen-only')), findsOneWidget);
    expect(find.byKey(const Key('event-card-unknown-date')), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets(
      'source chip and unread toggle keep search text; clear still clears once',
      (tester) async {
    await _pumpFixture(tester);

    await tester.enterText(find.byKey(_searchKey), 'english');
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, 'english');
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, 'english');
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.text('没有匹配'), findsOneWidget);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, 'english');
    expect(_toggle(tester).value, isTrue);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.text('暂无未读'), findsOneWidget);

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isTrue);
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

bool _searchHasFocus(WidgetTester tester) {
  final editable = tester.widget<EditableText>(
    find.descendant(
      of: find.byKey(_searchKey),
      matching: find.byType(EditableText),
    ),
  );
  return editable.focusNode.hasFocus;
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
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
