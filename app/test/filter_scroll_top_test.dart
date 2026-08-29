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

const _scrollKey = Key('timeline-scroll');
const _searchKey = Key('timeline-search');
const _weiboKey = Key('source-filter-weibo');
const _toggleKey = Key('unread-only-toggle');
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
  testWidgets(
      'memory(120) then type 破圈 jumps timeline-scroll to top; only 同日破圈',
      (tester) async {
    final scrollOffset = ScrollOffsetStore.memory(120);
    await _pumpFixture(tester, scrollOffset: scrollOffset);

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    for (final id in _allFixtureIds) {
      if (id == 'same-day-breaking') continue;
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }
  });

  testWidgets('memory(120) then tap source-filter-weibo jumps to top',
      (tester) async {
    await _pumpFixture(tester, scrollOffset: ScrollOffsetStore.memory(120));

    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(_chip(tester, _weiboKey).selected, isTrue);
  });

  testWidgets('memory(120) then flip unread-only-toggle jumps to top',
      (tester) async {
    await _pumpFixture(tester, scrollOffset: ScrollOffsetStore.memory(120));

    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(_toggle(tester).value, isTrue);
  });

  testWidgets(
      'cold-start 破圈 + memory(120) keeps T48 restore; T101 does not jumpTo(0)',
      (tester) async {
    await _pumpFixture(
      tester,
      scrollOffset: ScrollOffsetStore.memory(120),
      titleSearch: TitleSearchStore.memory('破圈'),
    );

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);

    final offset = _scrollPixels(tester);
    final max = _scrollMax(tester);
    final expected = 120.0.clamp(0.0, max);
    expect((offset - expected).abs(), lessThanOrEqualTo(2));
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required ScrollOffsetStore scrollOffset,
  TitleSearchStore? titleSearch,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: scrollOffset,
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: titleSearch ?? TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<SingleChildScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
}

double _scrollMax(WidgetTester tester) {
  return tester
      .widget<SingleChildScrollView>(find.byKey(_scrollKey))
      .controller!
      .position
      .maxScrollExtent;
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
