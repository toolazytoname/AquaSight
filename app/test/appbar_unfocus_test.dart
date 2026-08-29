import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _countKey = Key('unread-count');
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');
const _snackKey = Key('mark-all-read-snackbar');

void main() {
  testWidgets(
      'tap unread-count while search focused unfocuses, keeps query, does not open',
      (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, '破圈');

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
    // unfocus() hands PRIMARY FOCUS to the enclosing FocusScope, so
    // primaryFocus is null or a scope — never the search field.
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(opened, isEmpty);
  });

  testWidgets(
      'tap overflow while search focused unfocuses; mark-all still snacks; query stays',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, '破圈');

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(_searchField(tester).controller!.text, '破圈');

    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_snackKey), findsOneWidget);
    expect(find.text('已全部标为已读'), findsOneWidget);
    expect(_searchField(tester).controller!.text, '破圈');
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy');
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
