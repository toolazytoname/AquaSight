import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');
const _breakingUnreadDotKey = Key('event-card-same-day-breaking-unread-dot');

void main() {
  testWidgets(
      'unread-dot key is a descendant of Tooltip 未读',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    expect(find.byKey(_breakingUnreadDotKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('未读'),
        matching: find.byKey(_breakingUnreadDotKey),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
      'pre-seeded read breaking card has no unread dot and no 未读 tooltip',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({'same-day-breaking'}),
    );

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_breakingUnreadDotKey), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(_breakingKey),
        matching: find.byTooltip('未读'),
      ),
      findsNothing,
    );
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  ReadStore? readStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: (_) async {},
      readStore: readStore ?? ReadStore.memory(),
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
