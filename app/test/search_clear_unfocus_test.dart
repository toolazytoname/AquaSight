import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _clearKey = Key('timeline-search-clear');
const _toggleKey = Key('unread-only-toggle');
const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
const _englishKey = Key('event-card-missing-title-zh');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'tap timeline-search-clear unfocuses; query empty; filters stay',
      (tester) async {
    var loads = 0;
    final unreadOnly = UnreadOnlyStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return loadFixtureBytes();
          },
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: unreadOnly,
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(loads, 1);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);

    await tester.tap(find.byKey(_searchKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);

    await tester.enterText(find.byKey(_searchKey), 'e');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, 'e');
    expect(find.byKey(_clearKey), findsOneWidget);
    _expectEHits();

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
    expect(_searchHasFocus(tester), isFalse);
    // unfocus() hands PRIMARY FOCUS to the enclosing FocusScope, so
    // primaryFocus is null or a scope — never the search field.
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(loads, 1);
  });
}

FocusNode _searchFocusNode(WidgetTester tester) {
  return tester
      .widget<EditableText>(
        find.descendant(
          of: find.byKey(_searchKey),
          matching: find.byType(EditableText),
        ),
      )
      .focusNode;
}

bool _searchHasFocus(WidgetTester tester) {
  return _searchFocusNode(tester).hasFocus;
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

void _expectEHits() {
  expect(find.byKey(_englishKey), findsOneWidget);
  expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
      findsOneWidget);
  expect(find.byKey(const Key('event-card-seen-only')), findsOneWidget);
  expect(find.byKey(const Key('event-card-unknown-date')), findsOneWidget);
  expect(find.byKey(_breakingKey), findsNothing);
  expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
  expect(find.byKey(const Key('timeline-empty')), findsNothing);
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
