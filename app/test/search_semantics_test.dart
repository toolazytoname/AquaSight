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
const _clearKey = Key('timeline-search-clear');
const _breakingKey = Key('event-card-same-day-breaking');
const _englishKey = Key('event-card-missing-title-zh');

void main() {
  testWidgets(
      'timeline-search is a TextField under Semantics 搜索标题; no Tooltip wrap',
      (tester) async {
    await _pumpFixture(tester);

    expect(tester.widget(find.byKey(_searchKey)), isA<TextField>());
    expect(
      find.descendant(
        of: find.byWidgetPredicate(
          (widget) =>
              widget is Semantics && widget.properties.label == '搜索标题',
        ),
        matching: find.byKey(_searchKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel(RegExp('搜索标题')), findsWidgets);
    expect(_searchTooltipWrap(), findsNothing);
    expect(_searchField(tester).decoration!.hintText, '搜索标题');
    expect(find.byKey(_clearKey), findsNothing);
  });

  testWidgets(
      'typing filters titles; 搜索标题 semantics stay; clear has 清除 tooltip',
      (tester) async {
    await _pumpFixture(tester);

    await tester.enterText(find.byKey(_searchKey), 'english');
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, 'english');
    expect(find.byKey(_englishKey), findsOneWidget);
    expect(find.text('English-only title stays English'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.text('同日破圈'), findsNothing);
    expect(find.byKey(_clearKey), findsOneWidget);
    expect(find.byTooltip('清除'), findsOneWidget);

    expect(tester.widget(find.byKey(_searchKey)), isA<TextField>());
    expect(
      find.descendant(
        of: find.byWidgetPredicate(
          (widget) =>
              widget is Semantics && widget.properties.label == '搜索标题',
        ),
        matching: find.byKey(_searchKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel(RegExp('搜索标题')), findsWidgets);
    expect(_searchTooltipWrap(), findsNothing);
    expect(_searchField(tester).decoration!.hintText, '搜索标题');
  });
}

Finder _searchTooltipWrap() {
  return find.ancestor(
    of: find.byKey(_searchKey),
    matching: find.byWidgetPredicate(
      (widget) => widget is Tooltip && widget.message == '搜索标题',
    ),
  );
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
      sourceFilterStore: SourceFilterStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
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
