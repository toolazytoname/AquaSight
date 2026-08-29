import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _labelKey = Key('unread-only-label');
const _toggleKey = Key('unread-only-toggle');

void main() {
  testWidgets('unread-only-label is 未读; tooltip stays; no Semantics name',
      (tester) async {
    await _pumpApp(tester);

    expect(find.byKey(_labelKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_labelKey)).data, '未读');
    expect(find.byKey(_toggleKey), findsOneWidget);
    expect(find.byTooltip('只看未读'), findsOneWidget);
    expect(find.bySemanticsLabel('只看未读'), findsNothing);
  });

  testWidgets('tap switch turns unread-only on; list stays', (tester) async {
    await _pumpApp(tester);

    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(const Key('timeline-scroll')), findsOneWidget);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-breaking')), findsOneWidget);
  });

  testWidgets('tap unread-only-label does not toggle the switch',
      (tester) async {
    await _pumpApp(tester);

    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_labelKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
  });
}

Future<void> _pumpApp(WidgetTester tester) async {
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
