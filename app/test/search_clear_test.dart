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
const _weiboKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets('just after load the search clear control is absent',
      (tester) async {
    await _pumpFixture(tester);

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('没有匹配'), findsNothing);
  });

  testWidgets('zzzz-nomatch shows clear; tap restores fixture cards',
      (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, 'zzzz-nomatch');

    expect(find.byKey(_clearKey), findsOneWidget);
    expect(find.byTooltip('清除'), findsOneWidget);
    expect(find.byIcon(Icons.clear), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('clear after weibo + no-match keeps source and unread-only',
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

    await _tapChip(tester, _weiboKey);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isFalse);

    await _typeSearch(tester, 'zzzz-nomatch');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.text('没有匹配'), findsNothing);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(loads, 1);
  });

  testWidgets('tapping clear does not open a URL and does not share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          shared.add((title: title, url: url));
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await _typeSearch(tester, 'zzzz-nomatch');
    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('spaces count as input so the clear control is drawn',
      (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, '   ');

    expect(_searchField(tester).controller!.text, '   ');
    expect(find.byKey(_clearKey), findsOneWidget);
    expect(find.byKey(_breakingKey), findsOneWidget);

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
  });

  testWidgets('T34 enterText empty still clears without the suffix button',
      (tester) async {
    await _pumpFixture(tester);

    await _typeSearch(tester, 'zzzz-nomatch');
    expect(find.byKey(_clearKey), findsOneWidget);
    expect(find.text('没有匹配'), findsOneWidget);

    await _typeSearch(tester, '');
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
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

Future<void> _typeSearch(WidgetTester tester, String query) async {
  await tester.enterText(find.byKey(_searchKey), query);
  await tester.pumpAndSettle();
}

Future<void> _tapChip(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
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
