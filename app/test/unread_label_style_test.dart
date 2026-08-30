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
  testWidgets(
      'unread-only-label uses labelMedium + onSurfaceVariant; row stays ≥ 48',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpApp(tester);

    final labelFinder = find.byKey(_labelKey);
    expect(tester.widget<Text>(labelFinder).data, '未读');

    final label = tester.widget<Text>(labelFinder);
    final theme = Theme.of(tester.element(labelFinder));
    expect(label.style!.color, theme.colorScheme.onSurfaceVariant);
    expect(label.style!.fontSize, theme.textTheme.labelMedium!.fontSize);

    expect(find.byKey(_toggleKey), findsOneWidget);
    final box = tester.firstWidget<ConstrainedBox>(
      find.ancestor(
        of: labelFinder,
        matching: find.byType(ConstrainedBox),
      ),
    );
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
