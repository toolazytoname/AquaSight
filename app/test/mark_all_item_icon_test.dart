import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');
const _iconKey = Key('mark-all-read-icon');

void main() {
  testWidgets(
      'mark-all-read item shows done_all icon left of 全标已读',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(find.byTooltip('全标已读'), findsOneWidget);
    expect(find.byKey(_markAllKey), findsNothing);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_markAllKey), findsOneWidget);
    expect(find.byKey(_iconKey), findsOneWidget);

    final item = tester.widget<PopupMenuItem<String>>(find.byKey(_markAllKey));
    expect(item.height, kMinInteractiveDimension);

    final iconFinder = find.byKey(_iconKey);
    final icon = tester.widget<Icon>(iconFinder);
    expect(icon.icon, Icons.done_all);
    expect(icon.size, 20);

    final scheme = Theme.of(tester.element(iconFinder)).colorScheme;
    expect(icon.color, scheme.onSurfaceVariant);

    final textFinder = find.descendant(
      of: find.byKey(_markAllKey),
      matching: find.byType(Text),
    );
    expect(textFinder, findsOneWidget);
    expect(tester.widget<Text>(textFinder).data, '全标已读');

    expect(
      tester.getTopLeft(iconFinder).dx,
      lessThan(tester.getTopLeft(textFinder).dx),
    );
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
