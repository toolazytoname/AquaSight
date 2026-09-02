import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingCardKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'card source Chip uses 8px RoundedRectangleBorder and no side',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final chipFinder = find.descendant(
      of: find.byKey(_breakingCardKey),
      matching: find.byType(Chip),
    );
    expect(chipFinder, findsWidgets);

    for (final element in chipFinder.evaluate()) {
      final chip = element.widget as Chip;
      expect(chip.shape, isA<RoundedRectangleBorder>());
      expect(
        (chip.shape as RoundedRectangleBorder).borderRadius,
        BorderRadius.circular(8),
      );
      expect(chip.side, BorderSide.none);
    }
  });
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
