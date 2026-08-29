import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _countKey = Key('unread-count');
const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _openErrorSnackKey = Key('open-error-snackbar');

void main() {
  testWidgets(
      'tap breaking title while search focused unfocuses, opens once, keeps query, marks read',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingTitleKey), findsOneWidget);

    await tester.tap(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(opened, hasLength(1));
    expect(_searchHasFocus(tester), isFalse);
    // unfocus() hands PRIMARY FOCUS to the enclosing FocusScope, so
    // primaryFocus is null or a scope — never the search field.
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingReadKey), findsOneWidget);
    expect(_countText(tester), '未读 5');
    expect(find.byKey(_openErrorSnackKey), findsNothing);
    expect(find.text('无法打开'), findsNothing);
  });

  testWidgets(
      'openUrl throw while search focused unfocuses, shows 无法打开, does not mark read',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async {
          opened.add(uri);
          throw StateError('opener failed');
        },
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);
    expect(_searchField(tester).controller!.text, '破圈');

    await tester.tap(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(opened, hasLength(1));
    expect(_searchHasFocus(tester), isFalse);
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_openErrorSnackKey), findsOneWidget);
    expect(find.text('无法打开'), findsOneWidget);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
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

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy');
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
