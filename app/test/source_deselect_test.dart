import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _toggleKey = Key('unread-only-toggle');
const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets('tap weibo then tap weibo again restores every fixture card',
      (tester) async {
    await _pumpFixture(tester);

    await _tapChip(tester, _weiboKey);

    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsNothing);
    expect(find.byKey(const Key('event-card-seen-only')), findsNothing);
    expect(find.byKey(const Key('event-card-missing-title-zh')), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);

    await _tapChip(tester, _weiboKey);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    _expectAllFixtureCards();
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('tap 全部 when already 全部 stays 全部', (tester) async {
    await _pumpFixture(tester);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);

    await _tapChip(tester, _allKey);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    _expectAllFixtureCards();
  });

  testWidgets('deselect weibo keeps unread-only and search text',
      (tester) async {
    await _pumpFixture(tester);

    await _tapChip(tester, _weiboKey);
    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    await _typeSearch(tester, '破圈');

    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(_toggle(tester).value, isTrue);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);

    await _tapChip(tester, _weiboKey);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(_toggle(tester).value, isTrue);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets('tapping a chip does not open a URL and does not share',
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

    await _tapChip(tester, _weiboKey);
    await _tapChip(tester, _weiboKey);

    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_chip(tester, _allKey).selected, isTrue);
    _expectAllFixtureCards();
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

void _expectAllFixtureCards() {
  for (final id in _allFixtureIds) {
    expect(find.byKey(Key('event-card-$id')), findsOneWidget);
  }
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
