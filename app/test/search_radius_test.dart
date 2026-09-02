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
      'timeline-search outline borders use 8px radius',
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

    final fieldFinder = find.byKey(const Key('timeline-search'));
    final decoration = tester.widget<TextField>(fieldFinder).decoration!;
    final scheme = Theme.of(tester.element(fieldFinder)).colorScheme;
    expect(decoration.enabledBorder, isA<OutlineInputBorder>());
    expect(
      (decoration.enabledBorder as OutlineInputBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(
      (decoration.enabledBorder as OutlineInputBorder).borderSide.color,
      scheme.outline,
    );

    expect(decoration.focusedBorder, isA<OutlineInputBorder>());
    expect(
      (decoration.focusedBorder as OutlineInputBorder).borderRadius,
      BorderRadius.circular(8),
    );

    expect(decoration.border, isA<OutlineInputBorder>());
    expect(
      (decoration.border as OutlineInputBorder).borderRadius,
      BorderRadius.circular(8),
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
