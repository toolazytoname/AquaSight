import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _toggleKey = Key('unread-only-toggle');

void main() {
  testWidgets(
      'unread-only-toggle Switch trackOutlineColor is transparent when selected, outline otherwise',
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
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final toggleFinder = find.byKey(_toggleKey);
    expect(toggleFinder, findsOneWidget);

    final toggle = tester.widget<Switch>(toggleFinder);
    final scheme = Theme.of(tester.element(toggleFinder)).colorScheme;

    final trackOutlineColor = toggle.trackOutlineColor;
    expect(trackOutlineColor, isNotNull);
    expect(
      trackOutlineColor!.resolve(const {WidgetState.selected}),
      Colors.transparent,
    );
    expect(trackOutlineColor.resolve(const {}), scheme.outline);

    final trackColor = toggle.trackColor;
    expect(trackColor, isNotNull);
    expect(
      trackColor!.resolve(const {WidgetState.selected}),
      scheme.primary,
    );
    expect(trackColor.resolve(const {}), scheme.surfaceContainerHighest);
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
