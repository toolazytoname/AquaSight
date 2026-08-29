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
const _searchIconKey = Key('timeline-search-icon');
const _clearKey = Key('timeline-search-clear');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'tap timeline-search-icon focuses empty search; no query change or refresh',
      (tester) async {
    var loads = 0;
    await _pumpLive(tester, onLoad: () => loads++);
    expect(loads, 1);
    expect(_searchHasFocus(tester), isFalse);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_clearKey), findsNothing);

    final icon = tester.widget<Icon>(find.byKey(_searchIconKey));
    expect(icon.icon, Icons.search);

    await tester.tap(find.byKey(_searchIconKey));
    await tester.pumpAndSettle();

    expect(_searchFocusNode(tester).hasFocus, isTrue);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_clearKey), findsNothing);
    expect(loads, 1);
  });

  testWidgets(
      'tap timeline-search-icon with text keeps query, focus, and clear',
      (tester) async {
    var loads = 0;
    await _pumpLive(tester, onLoad: () => loads++);
    expect(loads, 1);

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_clearKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsOneWidget);

    await tester.tap(find.text('鸭先知'));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isFalse);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_clearKey), findsOneWidget);

    await tester.tap(find.byKey(_searchIconKey));
    await tester.pumpAndSettle();

    expect(_searchFocusNode(tester).hasFocus, isTrue);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_clearKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(loads, 1);
  });

  testWidgets(
      'tap timeline-search-icon while already focused is a no-op',
      (tester) async {
    var loads = 0;
    await _pumpLive(tester, onLoad: () => loads++);
    expect(loads, 1);

    await tester.tap(find.byKey(_searchIconKey));
    await tester.pumpAndSettle();
    expect(_searchFocusNode(tester).hasFocus, isTrue);
    expect(_searchField(tester).controller!.text, isEmpty);

    await tester.tap(find.byKey(_searchIconKey));
    await tester.pumpAndSettle();

    expect(_searchFocusNode(tester).hasFocus, isTrue);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(loads, 1);
  });
}

Future<void> _pumpLive(
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
