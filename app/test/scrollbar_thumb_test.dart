import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  testWidgets(
      'timeline and source-filter Scrollbars use ColorScheme.outline thumbs',
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

    final listBar = tester.widget<Scrollbar>(
      find.ancestor(
        of: find.byKey(const Key('timeline-scroll')),
        matching: find.byType(Scrollbar),
      ),
    );
    final listScheme = Theme.of(
      tester.element(find.byKey(const Key('timeline-scroll'))),
    ).colorScheme;
    expect(listBar.thumbColor, listScheme.outline);

    final sourceBar = tester.widget<Scrollbar>(
      find.byKey(const Key('source-filter-scrollbar')),
    );
    final sourceScheme = Theme.of(
      tester.element(find.byKey(const Key('source-filter-scrollbar'))),
    ).colorScheme;
    expect(sourceBar.thumbColor, sourceScheme.outline);
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
