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
const _toggleKey = Key('unread-only-toggle');
const _allKey = Key('source-filter-all');
const _breakingKey = Key('event-card-same-day-breaking');
const _normalHighScoreKey = Key('event-card-same-day-normal-high-score');

void main() {
  testWidgets('empty focused search: system back unfocuses; page stays', (
    tester,
  ) async {
    var loads = 0;
    await _pumpApp(tester, onLoad: () => loads++);
    expect(loads, 1);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(_toggle(tester).value, isFalse);
    expect(_chip(tester, _allKey).selected, isTrue);

    await tester.tap(find.byKey(_searchKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.text('鸭先知'), findsOneWidget);
    expect(_searchHasFocus(tester), isFalse);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(_toggle(tester).value, isFalse);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(find.byKey(_normalHighScoreKey), findsOneWidget);
    expect(loads, 1);
  });

  testWidgets('system back: unfocus first, then clear filters; page stays', (
    tester,
  ) async {
    var loads = 0;
    await _pumpApp(tester, onLoad: () => loads++);
    expect(loads, 1);

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_normalHighScoreKey), findsNothing);

    // enterText focuses the field. Dismiss so this pop clears filters.
    await tester.tap(find.text('鸭先知'));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isFalse);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_normalHighScoreKey), findsOneWidget);
    expect(loads, 1);
    expect(find.text('鸭先知'), findsOneWidget);

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_searchKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_normalHighScoreKey), findsNothing);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_normalHighScoreKey), findsNothing);
    expect(loads, 1);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_normalHighScoreKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(loads, 1);
    expect(find.text('鸭先知'), findsOneWidget);
  });
}

Future<void> _pumpApp(
  WidgetTester tester, {
  required VoidCallback onLoad,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async {
          onLoad();
          return loadFixtureBytes();
        },
        loadCache: () async => throw StateError('must not read cache'),
        loadFallback: () async => throw StateError('must not read sibling'),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
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
