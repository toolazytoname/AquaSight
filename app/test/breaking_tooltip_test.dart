import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingBadgeKey = Key('event-card-same-day-breaking-breaking');
const _normalBadgeKey = Key('event-card-same-day-normal-high-score-breaking');
const _normalCardKey = Key('event-card-same-day-normal-high-score');

void main() {
  testWidgets(
      'breaking badge has 突发 tooltip; no Semantics label; key stays on Text',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    expect(find.byTooltip('突发'), findsOneWidget);
    expect(find.byKey(_breakingBadgeKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_breakingBadgeKey)), isA<Text>());
    expect(
      find.descendant(
        of: find.byTooltip('突发'),
        matching: find.byKey(_breakingBadgeKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('突发'), findsNothing);
    expect(_tooltipSemantics('突发'), findsOne);

    expect(find.byKey(_normalBadgeKey), findsNothing);
    expect(find.byKey(_normalCardKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_normalCardKey),
        matching: find.byTooltip('突发'),
      ),
      findsNothing,
    );
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: (_) async {},
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
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
