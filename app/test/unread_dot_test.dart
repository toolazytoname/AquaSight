import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _breakingUnreadDotKey = Key('event-card-same-day-breaking-unread-dot');

void main() {
  testWidgets(
      'first load shows an 8×8 unread dot on the unread breaking card',
      (tester) async {
    await _pumpFixture(tester, readStore: ReadStore.memory());

    expect(find.byKey(_breakingUnreadDotKey), findsOneWidget);
    expect(tester.getSize(find.byKey(_breakingUnreadDotKey)), const Size(8, 8));
    expect(find.byKey(_breakingReadKey), findsNothing);
  });

  testWidgets(
      'openUrl success removes the unread dot and shows the 已读 chip',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await _pumpFixture(
      tester,
      readStore: store,
      openUrl: (uri) async => opened.add(uri),
    );

    expect(find.byKey(_breakingUnreadDotKey), findsOneWidget);

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingUnreadDotKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsOneWidget);
  });

  testWidgets('markRead then pump has no unread-dot on that card',
      (tester) async {
    final store = ReadStore.memory();
    await store.markRead('same-day-breaking');
    await _pumpFixture(tester, readStore: store);

    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingUnreadDotKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsOneWidget);
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
