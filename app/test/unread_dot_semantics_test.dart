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

Finder _breakingUnreadSemantics() {
  return find.descendant(
    of: find.byKey(_breakingKey),
    matching: find.bySemanticsLabel('未读'),
  );
}

void main() {
  testWidgets(
      'first load announces 未读 on the unread-dot of the breaking card',
      (tester) async {
    await _pumpFixture(tester, readStore: ReadStore.memory());

    expect(_breakingUnreadSemantics(), findsOneWidget);
    expect(find.byKey(_breakingUnreadDotKey), findsOneWidget);
  });

  testWidgets(
      'openUrl success drops 未读 semantics and the unread-dot key',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await _pumpFixture(
      tester,
      readStore: store,
      openUrl: (uri) async => opened.add(uri),
    );

    expect(_breakingUnreadSemantics(), findsOneWidget);

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(_breakingUnreadSemantics(), findsNothing);
    expect(find.byKey(_breakingUnreadDotKey), findsNothing);
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required ReadStore readStore,
  Future<void> Function(Uri uri)? openUrl,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl ?? _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore,
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
