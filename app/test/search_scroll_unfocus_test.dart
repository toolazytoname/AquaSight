import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _searchIconKey = Key('timeline-search-icon');
const _scrollKey = Key('timeline-scroll');
const _emptyKey = Key('timeline-empty');
const _errorKey = Key('timeline-error');

void main() {
  testWidgets(
      'tap search then drag timeline-scroll unfocuses',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpFixture(tester);

    await tester.tap(find.byKey(_searchKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);

    await tester.drag(find.byKey(_scrollKey), const Offset(0, -80));
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
  });

  testWidgets(
      'tap timeline-search-icon then drag timeline-scroll unfocuses',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpFixture(tester);

    await tester.tap(find.byKey(_searchIconKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);

    await tester.drag(find.byKey(_scrollKey), const Offset(0, -80));
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
  });

  testWidgets(
      'empty page CustomScrollView dismisses keyboard on drag',
      (tester) async {
    _setDefaultSurface(tester);
    await tester.pumpWidget(
      _app(EventsRepository.fromJsonString(_emptyFixture())),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_scrollKey), findsNothing);
    expect(
      _refreshScrollView(tester).keyboardDismissBehavior,
      ScrollViewKeyboardDismissBehavior.onDrag,
    );
  });

  testWidgets(
      'error page CustomScrollView dismisses keyboard on drag',
      (tester) async {
    _setDefaultSurface(tester);
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_scrollKey), findsNothing);
    expect(
      _refreshScrollView(tester).keyboardDismissBehavior,
      ScrollViewKeyboardDismissBehavior.onDrag,
    );
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    _app(EventsRepository.fromJsonString(loadFixtureBytes())),
  );
  await tester.pumpAndSettle();
}

Widget _app(EventsRepository repository) {
  return AquaApp(
    repository: repository,
    openUrl: _forbidLaunch,
    shareEvent: _forbidShare,
    copyText: _forbidCopy,
    readStore: ReadStore.memory(),
    unreadOnlyStore: UnreadOnlyStore.memory(),
    scrollOffsetStore: ScrollOffsetStore.memory(),
  );
}

CustomScrollView _refreshScrollView(WidgetTester tester) {
  return tester.widget<CustomScrollView>(
    find.descendant(
      of: find.byType(RefreshIndicator),
      matching: find.byType(CustomScrollView),
    ),
  );
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

String _emptyFixture() {
  final raw = loadFixtureJson();
  raw['items'] = [];
  return jsonEncode(raw);
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share ($url)');
}

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
