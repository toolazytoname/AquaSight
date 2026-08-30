import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  testWidgets(
      'search hint, magnifier, and clear use ColorScheme.onSurfaceVariant',
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
        sourceFilterStore: SourceFilterStore.memory(),
        titleSearchStore: TitleSearchStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final decoration =
        tester.widget<TextField>(find.byKey(const Key('timeline-search'))).decoration!;
    final scheme =
        Theme.of(tester.element(find.byKey(const Key('timeline-search')))).colorScheme;
    expect(decoration.hintStyle!.color, scheme.onSurfaceVariant);
    expect(
      tester.widget<Icon>(find.byKey(const Key('timeline-search-icon'))).color,
      scheme.onSurfaceVariant,
    );

    await tester.enterText(find.byKey(const Key('timeline-search')), 'a');
    await tester.pump();

    expect(
      tester.widget<IconButton>(find.byKey(const Key('timeline-search-clear'))).color,
      scheme.onSurfaceVariant,
    );
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
