import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/timeline_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _hitKey = Key('unread-count-hit');

void main() {
  testWidgets(
      'unread-count uses labelLarge + onSurface; hit target stays 48×48',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpApp(tester);

    final countFinder = find.byKey(_countKey);
    expect(countFinder, findsOneWidget);

    final unreadN = (loadFixtureJson()['items'] as List).length;
    final count = tester.widget<Text>(countFinder);
    expect(count.data, unreadCountLabel(unreadN));
    expect(count.data, isNot('回顶'));

    final theme = Theme.of(tester.element(countFinder));
    expect(count.style!.fontSize, theme.textTheme.labelLarge!.fontSize);
    expect(count.style!.color, theme.colorScheme.onSurface);
    expect(count.style!.color, isNot(theme.colorScheme.onSurfaceVariant));

    final box = tester.firstWidget<ConstrainedBox>(
      find.descendant(
        of: find.byKey(_hitKey),
        matching: find.byType(ConstrainedBox),
      ),
    );
    expect(box.constraints.minWidth, 48);
    expect(box.constraints.minHeight, 48);
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
