import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _breakingMarkUnreadKey = Key('event-card-same-day-breaking-mark-unread');

void main() {
  testWidgets(
      'tap share while search focused unfocuses, shares once, keeps query, does not open',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url, Rect sharePositionOrigin})>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          shared.add((
            title: title,
            url: url,
            sharePositionOrigin: sharePositionOrigin,
          ));
        },
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, '破圈');

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(shared, hasLength(1));
    expect(_searchHasFocus(tester), isFalse);
    // unfocus() hands PRIMARY FOCUS to the enclosing FocusScope, so
    // primaryFocus is null or a scope — never the search field.
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(opened, isEmpty);
    expect(_searchField(tester).controller!.text, '破圈');
  });

  testWidgets(
      'tap 已读 mark-unread while search focused unfocuses, unmarks, keeps query, does not open or share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url, Rect sharePositionOrigin})>[];
    final store = ReadStore.memory();
    await store.markRead('same-day-breaking');
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          shared.add((
            title: title,
            url: url,
            sharePositionOrigin: sharePositionOrigin,
          ));
        },
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingMarkUnreadKey), findsOneWidget);

    await tester.tap(find.byKey(_breakingMarkUnreadKey));
    await tester.pumpAndSettle();

    expect(store.isRead('same-day-breaking'), isFalse);
    expect(_searchHasFocus(tester), isFalse);
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(opened, isEmpty);
    expect(shared, isEmpty);
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
