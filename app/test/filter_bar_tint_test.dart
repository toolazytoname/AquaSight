import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _barKey = Key('source-filter-bar');
const _allKey = Key('source-filter-all');

void main() {
  testWidgets(
      'source-filter-bar Material has transparent tint, elevation 0, surface color',
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

    final materialFinder = find.byKey(_barKey);
    expect(materialFinder, findsOneWidget);

    final material = tester.widget<Material>(materialFinder);
    expect(material.surfaceTintColor, Colors.transparent);
    expect(material.elevation, 0);
    final scheme = Theme.of(tester.element(materialFinder)).colorScheme;
    expect(material.color, scheme.surface);

    expect(
      find.descendant(of: materialFinder, matching: find.byKey(_allKey)),
      findsOneWidget,
    );
  });
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
