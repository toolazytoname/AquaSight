import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingShareKey = Key('event-card-same-day-breaking-share');

void main() {
  testWidgets(
      'share IconButton uses onSurfaceVariant; tooltip 分享; hit ≥ 48',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

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

    final shareFinder = find.byKey(_breakingShareKey);
    expect(shareFinder, findsOneWidget);

    final buttonFinder = find.descendant(
      of: shareFinder,
      matching: find.byType(IconButton),
    );
    final button = tester.widget<IconButton>(buttonFinder);
    final scheme = Theme.of(tester.element(buttonFinder)).colorScheme;
    expect(button.color, scheme.onSurfaceVariant);
    expect(button.color, isNot(scheme.primary));
    expect(button.tooltip, '分享');
    expect(
      find.descendant(
        of: shareFinder,
        matching: find.byTooltip('分享'),
      ),
      findsOneWidget,
    );

    final shareSize = tester.getSize(shareFinder);
    expect(shareSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(shareSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));
  });
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
