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

void main() {
  testWidgets(
      'mark-all-read item uses labelLarge + onSurface; height is 48',
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

    final item = tester.widget<PopupMenuItem<String>>(find.byKey(_markAllKey));
    expect(item.height, kMinInteractiveDimension);

    final textFinder = find.descendant(
      of: find.byKey(_markAllKey),
      matching: find.byType(Text),
    );
    expect(textFinder, findsOneWidget);

    final text = tester.widget<Text>(textFinder);
    expect(text.data, '全标已读');

    final theme = Theme.of(tester.element(textFinder));
    expect(text.style!.fontSize, theme.textTheme.labelLarge!.fontSize);
    expect(text.style!.color, theme.colorScheme.onSurface);

    expect(find.descendant(
      of: find.byKey(_markAllKey),
      matching: find.byType(Icon),
    ), findsNothing);
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
