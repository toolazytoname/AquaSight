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

void main() {
  testWidgets(
      'timeline-search-icon hit target is at least 48×48',
      (tester) async {
    await _pumpLive(tester);

    final hitFinder = find.ancestor(
      of: find.byKey(_searchIconKey),
      matching: find.byType(GestureDetector),
    );
    expect(hitFinder, findsAtLeastNWidgets(1));

    final hitSize = tester.getSize(hitFinder.first);
    expect(hitSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(hitSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));
  });

  testWidgets(
      'tap timeline-search-icon focuses field; does not clear',
      (tester) async {
    await _pumpLive(tester);

    expect(_searchHasFocus(tester), isFalse);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);

    await tester.tap(find.byKey(_searchIconKey));
    await tester.pumpAndSettle();

    expect(_searchFocusNode(tester).hasFocus, isTrue);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
  });
}

Future<void> _pumpLive(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async => loadFixtureBytes(),
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
